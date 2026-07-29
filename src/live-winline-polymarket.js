const aliases = require('../config/participant-aliases.json');
const { fetchSportsEvents, enrichMarket } = require('./polymarket');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { getLatestSourceSnapshot } = require('./storage/postgres-store');

const WINLINE_URLS = Object.freeze({
  baseball: 'https://winline.ru/stavki/sport/bejsbol/ssha/mlb',
  ufc: 'https://winline.ru/stavki/sport/mma/ufc',
});

const DEFAULT_WINLINE_SNAPSHOT_URL = 'https://raw.githubusercontent.com/0ddafag/prediction-arb-dashboard/winline-feed/data/live-winline.json';

function canonicalParticipant(sport, name) {
  return aliases[sport]?.[String(name || '').trim()] || null;
}

function pairKey(values) {
  return [...values].sort().join('|');
}

function utcDate(value) {
  const time = typeof value === 'number' ? value : (value instanceof Date ? value.getTime() : Date.parse(value));
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : null;
}

function parseWinlineTime(raw, now = new Date()) {
  const value = String(raw || '').trim();
  const base = new Date(now);
  const setHm = (date, hh, mm) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), Number(hh), Number(mm), 0));
  let match = value.match(/^Сегодня\s+(\d{1,2}):(\d{2})$/);
  if (match) {
    const date = setHm(base, match[1], match[2]);
    if (date.getTime() <= base.getTime()) date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString();
  }
  match = value.match(/^Завтра\s+(\d{1,2}):(\d{2})$/);
  if (match) {
    const next = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + 1));
    return setHm(next, match[1], match[2]).toISOString();
  }
  match = value.match(/^(\d{2})\.(\d{2})\.(\d{2})\s+(\d{1,2}):(\d{2})$/);
  if (match) {
    const [, dd, mm, yy, hh, min] = match;
    return new Date(Date.UTC(2000 + Number(yy), Number(mm) - 1, Number(dd), Number(hh), Number(min), 0)).toISOString();
  }
  return null;
}

function isOddsToken(value) {
  if (!/^\d+(?:\.\d+)?$/.test(String(value || ''))) return false;
  const number = Number(value);
  return Number.isFinite(number) && number > 1;
}

function firstOddsAfterMatch(lines, index, sport) {
  const odds = [];
  for (let i = index + 1; i < Math.min(lines.length, index + 12); i += 1) {
    const value = lines[i];
    if (value === '-' || /^[+−-]\s*\d/.test(value)) continue;
    if (isOddsToken(value)) odds.push(Number(value));
    if (odds.length >= 3) break;
    if (/^(\d+|\d+\s+иннинг|1 иннинг|2 иннинг|3 иннинг|4 иннинг)$/i.test(value) && odds.length) break;
  }
  if (sport === 'ufc' && odds.length >= 3 && odds[1] >= 20) {
    return { home: odds[0], draw: odds[1], away: odds[2] };
  }
  return odds.length >= 2 ? { home: odds[0], away: odds[1] } : null;
}

function parseWinlineText(text, { sport, now = new Date(), sourceUrl = WINLINE_URLS[sport] } = {}) {
  const lines = String(text || '').split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const candidates = [];
  for (let i = 2; i < lines.length; i += 1) {
    const startAt = parseWinlineTime(lines[i], now);
    if (!startAt) continue;
    const team1 = lines[i - 2];
    const team2 = lines[i - 1];
    const c1 = canonicalParticipant(sport, team1);
    const c2 = canonicalParticipant(sport, team2);
    if (!c1 || !c2 || c1 === c2) continue;
    let matchIndex = i + 1;
    if (/^\+\d+$/.test(lines[matchIndex])) matchIndex += 1;
    if (lines[matchIndex] !== 'Матч') continue;
    const odds = firstOddsAfterMatch(lines, matchIndex, sport);
    if (!odds) continue;
    const providerEventId = `${sport}-${c1}-${c2}-${startAt.slice(0, 16).replace(/[-:T]/g, '')}`;
    candidates.push({
      bookmaker: 'winline',
      sport,
      competition: sport === 'baseball' ? 'MLB' : 'UFC',
      provider_event_id: providerEventId,
      participants: [team1, team2],
      canonical_participants: [c1, c2],
      start_at: startAt,
      source_url: sourceUrl,
      outcomes: [
        { key: 'home', label: team1, decimal_odds: odds.home, factor_id: 'home' },
        ...(odds.draw ? [{ key: 'draw', label: 'Draw', decimal_odds: odds.draw, factor_id: 'draw' }] : []),
        { key: 'away', label: team2, decimal_odds: odds.away, factor_id: 'away' },
      ].filter((item) => Number.isFinite(item.decimal_odds)),
    });
  }
  return candidates;
}

async function fetchRenderedText(url) {
  let chromium;
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH) process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
  try {
    ({ chromium } = require('playwright'));
  } catch (error) {
    throw new Error(`Playwright is required for Winline live DOM fetch: ${error.message}`);
  }
  const launchOptions = {
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  };
  let browser;
  try {
    browser = await chromium.launch(launchOptions);
  } catch (error) {
    if (!/Executable doesn't exist|Please run the following command to download new browsers/i.test(String(error?.message || error))) {
      throw error;
    }
    const playwrightCli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
    execFileSync(process.execPath, [playwrightCli, 'install', 'chromium'], {
      stdio: 'ignore',
      timeout: 360000,
    });
    browser = await chromium.launch(launchOptions);
  }
  try {
    const page = await browser.newPage({ locale: 'ru-RU', timezoneId: 'UTC' });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(6000);
    return await page.evaluate(() => document.body.innerText);
  } finally {
    await browser.close();
  }
}

async function fetchWinlineCandidates({ now = new Date(), fetchText = fetchRenderedText } = {}) {
  const entries = await Promise.all(Object.entries(WINLINE_URLS).map(async ([sport, url]) => {
    const text = await fetchText(url, sport);
    return parseWinlineText(text, { sport, now, sourceUrl: url });
  }));
  return entries.flat();
}

async function fetchWinlineSnapshotCandidates({
  snapshotUrl = process.env.WINLINE_SNAPSHOT_URL || DEFAULT_WINLINE_SNAPSHOT_URL,
  fetchJson,
} = {}) {
  const load = fetchJson || (async (url) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Winline snapshot HTTP ${response.status} from ${url}`);
    return response.json();
  });
  const databaseSnapshot = await getLatestSourceSnapshot('winline_browser_rendered_dom_snapshot');
  const payload = databaseSnapshot?.raw?.candidates
    ? { ...databaseSnapshot.raw, captured_at: databaseSnapshot.captured_at || databaseSnapshot.raw.captured_at }
    : fs.existsSync(path.join(__dirname, '..', 'data', 'live-winline.json'))
      ? JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'live-winline.json'), 'utf8'))
      : await load(snapshotUrl);
  if (!payload || !Array.isArray(payload.candidates)) {
    throw new Error('Winline snapshot payload is missing candidates[]');
  }
  const candidates = payload.candidates.filter((candidate) => (
    candidate?.bookmaker === 'winline'
    && WINLINE_URLS[candidate.sport]
    && Array.isArray(candidate.canonical_participants)
    && Array.isArray(candidate.outcomes)
    && Date.parse(candidate.start_at)
  )).map((candidate) => ({
    ...candidate,
    source_mode: 'snapshot_feed',
    source_url: candidate.source_url || snapshotUrl,
  }));
  Object.defineProperty(candidates, 'feed_captured_at', {
    value: payload.captured_at || null,
    enumerable: false,
  });
  Object.defineProperty(candidates, 'snapshot_url', {
    value: databaseSnapshot
      ? 'postgres:source_snapshots/winline_browser_rendered_dom_snapshot'
      : fs.existsSync(path.join(__dirname, '..', 'data', 'live-winline.json'))
        ? 'local:data/live-winline.json'
        : snapshotUrl,
    enumerable: false,
  });
  return candidates;
}

async function fetchDefaultWinlineCandidates(options = {}) {
  if (process.env.WINLINE_LIVE_MODE === 'browser') return fetchWinlineCandidates(options);
  return fetchWinlineSnapshotCandidates(options);
}

function parseSportsTime(value) {
  if (!value) return NaN;
  return Date.parse(String(value).replace(' ', 'T').replace(/\+00$/, '+00:00'));
}

function marketRecord(event, sport) {
  for (const market of event.markets || []) {
    if (market.sportsMarketType !== 'moneyline' || market.closed === true || market.active === false) continue;
    let outcomes;
    try { outcomes = Array.isArray(market.outcomes) ? market.outcomes : JSON.parse(market.outcomes); } catch { outcomes = []; }
    const canonical = outcomes.map((outcome) => canonicalParticipant(sport, outcome));
    if (canonical.length === 2 && canonical.every(Boolean) && new Set(canonical).size === 2) {
      return { ...market, parsed_outcomes: outcomes, canonical_outcomes: canonical };
    }
  }
  return null;
}

function eventMatches(candidate, market) {
  if (pairKey(candidate.canonical_participants) !== pairKey(market.canonical_outcomes)) return false;
  const candidateStart = Date.parse(candidate.start_at);
  const polyStart = parseSportsTime(market.gameStartTime);
  if (candidate.sport === 'baseball') return Number.isFinite(polyStart) && Math.abs(candidateStart - polyStart) <= 10 * 60 * 1000;
  return utcDate(candidate.start_at) === utcDate(polyStart);
}

function buildExactLiveMatches({ candidates, polymarketEvents, now = new Date() }) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const matches = [];
  const usedMarkets = new Set();
  for (const candidate of candidates) {
    if (Date.parse(candidate.start_at) <= nowMs) continue;
    for (const event of polymarketEvents) {
      if (event.active === false || event.closed === true) continue;
      const market = marketRecord(event, candidate.sport);
      if (!market || usedMarkets.has(String(market.id)) || !eventMatches(candidate, market)) continue;
      matches.push({ winline: candidate, polymarket: market, polymarket_event: event });
      usedMarkets.add(String(market.id));
      break;
    }
  }
  return matches;
}

function basisRiskFor(sport, outcomes) {
  if (sport === 'ufc' && outcomes.some((outcome) => outcome.key === 'draw')) return 'DRAW_NO_CONTEST';
  return 'RULES_MISMATCH';
}

function buildLiveCollections(matches, { capturedAt = new Date().toISOString(), overrides = {} } = {}) {
  const bookmakerInputs = [];
  const normalizedMarkets = [];
  const marketPairs = [];
  const bookmakerOverrides = overrides.bookmaker_odds || {};
  const pairOverrides = overrides.pair_prices || {};

  for (const match of matches) {
    const candidate = match.winline;
    const market = match.polymarket;
    const risk = basisRiskFor(candidate.sport, candidate.outcomes);
    const settlementScope = candidate.sport === 'baseball' ? 'full_game' : 'full_fight';
    for (const outcome of candidate.outcomes.filter((item) => item.key !== 'draw')) {
      const canonicalOutcome = canonicalParticipant(candidate.sport, outcome.label);
      const sameIndex = market.canonical_outcomes.indexOf(canonicalOutcome);
      if (sameIndex < 0) continue;
      const oppositeIndex = sameIndex === 0 ? 1 : 0;
      const suffix = `${candidate.provider_event_id}-${outcome.factor_id}`;
      const inputId = `live-winline-${suffix}`;
      const bookmakerMarketId = `bm-live-winline-${suffix}`;
      const pairId = `pair-live-winline-${suffix}`;
      const editedOdds = bookmakerOverrides[bookmakerMarketId];
      const pairPriceOverride = pairOverrides[pairId] || {};
      const odds = editedOdds == null ? outcome.decimal_odds : Number(editedOdds);
      bookmakerInputs.push({
        input_id: inputId,
        bookmaker_key: 'winline',
        source_mode: candidate.source_mode || 'browser_rendered_dom',
        source_ref: candidate.source_url,
        sport_raw: candidate.sport,
        event_raw: candidate.participants.join(' — '),
        event_time_raw: candidate.start_at,
        market_type_raw: 'moneyline',
        outcomes_raw_json: [{ outcome_key: outcome.key, outcome_label: outcome.label }],
        odds_raw_json: { [outcome.key]: outcome.decimal_odds },
        captured_at: capturedAt,
        parse_confidence: 0.9,
        review_status: 'mapped',
        review_notes: `Winline rendered DOM event=${candidate.provider_event_id}, side=${outcome.factor_id}.`,
        sport: candidate.sport,
      });
      normalizedMarkets.push({
        bookmaker_market_id: bookmakerMarketId,
        input_id: inputId,
        bookmaker_key: 'winline',
        event_title: candidate.participants.join(' — '),
        event_start_at: candidate.start_at,
        sport: candidate.sport,
        market_type: 'moneyline_2way',
        market_family: 'moneyline_2way',
        outcome_key: outcome.key,
        outcome_label: outcome.label,
        captured_decimal_odds: outcome.decimal_odds,
        edited_decimal_odds: editedOdds == null ? null : Number(editedOdds),
        effective_decimal_odds: odds,
        implied_prob: 1 / odds,
        limit_notes: candidate.source_mode === 'snapshot_feed'
          ? 'Winline snapshot feed; exact participant/date mapping only.'
          : 'Live Winline rendered public page; exact participant/date mapping only.',
        source_mode: candidate.source_mode || 'browser_rendered_dom',
        normalized_at: capturedAt,
      });
      marketPairs.push({
        pair_id: pairId,
        bookmaker_market_id: bookmakerMarketId,
        poly_market_id: String(market.id),
        poly_outcome_index: oppositeIndex,
        pairing_mode: 'explicit_alias_exact',
        mapping_confidence: 1,
        mapping_status: 'mapped',
        settlement_caveat: candidate.sport === 'ufc'
          ? 'Winline may quote draw/no-contest differently from Polymarket winner market.'
          : 'Cancellation/postponement settlement requires bookmaker-rules confirmation.',
        same_outcome_side: outcome.key,
        poly_hedge_side: 'OPPOSITE_YES',
        created_at: capturedAt,
        bookmaker_key: 'winline',
        sport: candidate.sport,
        market_family: 'moneyline_2way',
        settlement_scope: settlementScope,
        hedge_strategy: 'opposite_yes',
        basis_risk: risk,
        provider_event_id: candidate.provider_event_id,
        provider_factor_id: outcome.factor_id,
        poly_no_market_override: pairPriceOverride.poly_no_market_override ?? null,
        poly_no_limit_override: pairPriceOverride.poly_no_limit_override ?? null,
        poly_no_easy_override: pairPriceOverride.poly_no_easy_override ?? null,
      });
    }
  }
  return { bookmaker_inputs: bookmakerInputs, bookmaker_market_normalized: normalizedMarkets, market_pairs: marketPairs };
}

async function fetchLiveWinlinePolymarketSource({
  now = new Date(),
  overrides = {},
  fetchCandidates = fetchDefaultWinlineCandidates,
  fetchEvents = fetchSportsEvents,
  enrich = enrichMarket,
} = {}) {
  const capturedAt = new Date().toISOString();
  const [candidates, mlbEvents, ufcEvents] = await Promise.all([
    fetchCandidates({ now }),
    fetchEvents('mlb', { pages: 3 }),
    fetchEvents('ufc', { pages: 2 }),
  ]);
  const matches = buildExactLiveMatches({ candidates, polymarketEvents: [...mlbEvents, ...ufcEvents], now });
  const mappedMarkets = await Promise.all(matches.map((match) => enrich(match.polymarket)));
  const enrichedById = new Map(mappedMarkets.map((market) => [String(market.id), market]));
  const enrichedMatches = matches.map((match) => ({ ...match, polymarket: { ...enrichedById.get(String(match.polymarket.id)), canonical_outcomes: match.polymarket.canonical_outcomes } }));
  return {
    ...buildLiveCollections(enrichedMatches, { capturedAt, overrides }),
    mapped_markets: mappedMarkets,
    metadata: {
      source: candidates.snapshot_url ? 'winline_snapshot_feed+polymarket_gamma_clob' : 'winline_live_browser_dom',
      captured_at: candidates.feed_captured_at || capturedAt,
      snapshot_url: candidates.snapshot_url || null,
      candidate_count: candidates.length,
      matches: matches.length,
      matches_by_sport: matches.reduce((acc, match) => {
        acc[match.winline.sport] = (acc[match.winline.sport] || 0) + 1;
        return acc;
      }, {}),
      candidate_count_by_sport: candidates.reduce((acc, candidate) => {
        acc[candidate.sport] = (acc[candidate.sport] || 0) + 1;
        return acc;
      }, {}),
      unmatched_candidates: candidates
        .filter((candidate) => !matches.some((match) => match.winline.provider_event_id === candidate.provider_event_id))
        .slice(0, 25)
        .map((candidate) => ({ sport: candidate.sport, participants: candidate.participants, start_at: candidate.start_at })),
    },
  };
}

module.exports = {
  WINLINE_URLS,
  DEFAULT_WINLINE_SNAPSHOT_URL,
  parseWinlineTime,
  parseWinlineText,
  fetchWinlineCandidates,
  fetchWinlineSnapshotCandidates,
  fetchDefaultWinlineCandidates,
  buildExactLiveMatches,
  buildLiveCollections,
  fetchLiveWinlinePolymarketSource,
};
