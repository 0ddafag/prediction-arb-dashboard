const aliases = require('../config/participant-aliases.json');
const fonbet = require('./connectors/bookmakers/fonbet');
const { fetchSportsEvents, enrichMarket } = require('./polymarket');
const { getLatestSourceSnapshot } = require('./storage/postgres-store');

function parseMaybeJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function canonicalParticipant(sport, name) {
  return aliases[sport]?.[String(name).trim()] || null;
}

function pairKey(values) {
  return [...values].sort().join('|');
}

function parseSportsTime(value) {
  if (!value) return NaN;
  const normalized = String(value).replace(' ', 'T').replace(/\+00$/, '+00:00');
  return Date.parse(normalized);
}

function utcDate(value) {
  const time = typeof value === 'number' ? value : parseSportsTime(value);
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : null;
}

function eligibleFonbetCandidate(candidate, nowMs) {
  const startMs = Date.parse(candidate.start_at);
  if (!Number.isFinite(startMs) || startMs <= nowMs) return false;
  if (candidate.sport === 'baseball') return candidate.competition === 'MLB';
  if (candidate.sport === 'ufc') return /^MMA\. UFC(?:\s|\.)/.test(candidate.competition);
  return false;
}

function marketRecord(event, sport) {
  for (const market of event.markets || []) {
    if (market.sportsMarketType !== 'moneyline' || market.closed === true || market.active === false) continue;
    const outcomes = parseMaybeJsonArray(market.outcomes);
    const canonical = outcomes.map((outcome) => canonicalParticipant(sport, outcome));
    if (canonical.length === 2 && canonical.every(Boolean) && new Set(canonical).size === 2) {
      return { ...market, parsed_outcomes: outcomes, canonical_outcomes: canonical };
    }
  }
  return null;
}

function eventMatches(candidate, market) {
  const candidateIds = candidate.participants.map((name) => canonicalParticipant(candidate.sport, name));
  if (!candidateIds.every(Boolean) || pairKey(candidateIds) !== pairKey(market.canonical_outcomes)) return false;

  const candidateStart = Date.parse(candidate.start_at);
  const polyStart = parseSportsTime(market.gameStartTime);
  if (candidate.sport === 'baseball') {
    return Number.isFinite(polyStart) && Math.abs(candidateStart - polyStart) <= 10 * 60 * 1000;
  }
  return utcDate(candidateStart) === utcDate(polyStart);
}

function buildExactLiveMatches({ fonbetCandidates, polymarketEvents, now = new Date() }) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const matches = [];
  const usedMarkets = new Set();

  for (const candidate of fonbetCandidates) {
    if (!eligibleFonbetCandidate(candidate, nowMs)) continue;
    for (const event of polymarketEvents) {
      if (event.active === false || event.closed === true) continue;
      const market = marketRecord(event, candidate.sport);
      if (!market || usedMarkets.has(String(market.id)) || !eventMatches(candidate, market)) continue;
      matches.push({ fonbet: candidate, polymarket: market, polymarket_event: event });
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
    const candidate = match.fonbet;
    const market = match.polymarket;
    const risk = basisRiskFor(candidate.sport, candidate.outcomes);
    const settlementScope = candidate.sport === 'baseball' ? 'full_game' : 'full_fight';

    for (const outcome of candidate.outcomes.filter((item) => item.key !== 'draw')) {
      const canonicalOutcome = canonicalParticipant(candidate.sport, outcome.label);
      const sameIndex = market.canonical_outcomes.indexOf(canonicalOutcome);
      if (sameIndex < 0) continue;
      const oppositeIndex = sameIndex === 0 ? 1 : 0;
      const suffix = `${candidate.provider_event_id}-${outcome.factor_id}`;
      const inputId = `live-fonbet-${suffix}`;
      const bookmakerMarketId = `bm-live-fonbet-${suffix}`;
      const pairId = `pair-live-fonbet-${suffix}`;
      const editedOdds = bookmakerOverrides[bookmakerMarketId];
      const pairPriceOverride = pairOverrides[pairId] || {};

      bookmakerInputs.push({
        input_id: inputId,
        bookmaker_key: 'fonbet',
        source_mode: 'browser_public_transport',
        source_ref: candidate.source_url,
        sport_raw: candidate.sport,
        event_raw: candidate.participants.join(' — '),
        event_time_raw: candidate.start_at,
        market_type_raw: 'moneyline',
        outcomes_raw_json: [{ outcome_key: outcome.key, outcome_label: outcome.label }],
        odds_raw_json: { [outcome.key]: outcome.decimal_odds },
        captured_at: capturedAt,
        parse_confidence: 1,
        review_status: 'mapped',
        review_notes: `Fonbet event=${candidate.provider_event_id}, factor=${outcome.factor_id}, packet=${candidate.packet_version}.`,
        sport: candidate.sport,
      });

      normalizedMarkets.push({
        bookmaker_market_id: bookmakerMarketId,
        input_id: inputId,
        bookmaker_key: 'fonbet',
        event_title: candidate.participants.join(' — '),
        event_start_at: candidate.start_at,
        sport: candidate.sport,
        market_type: 'moneyline_2way',
        market_family: 'moneyline_2way',
        outcome_key: outcome.key,
        outcome_label: outcome.label,
        captured_decimal_odds: outcome.decimal_odds,
        edited_decimal_odds: editedOdds == null ? null : Number(editedOdds),
        effective_decimal_odds: editedOdds == null ? outcome.decimal_odds : Number(editedOdds),
        implied_prob: 1 / (editedOdds == null ? outcome.decimal_odds : Number(editedOdds)),
        limit_notes: 'Live Fonbet public client line; exact participant mapping only.',
        source_mode: 'browser_public_transport',
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
          ? 'Fonbet quotes draw; Polymarket winner market may resolve draw/no-contest differently.'
          : 'Cancellation/postponement settlement requires bookmaker-rules confirmation.',
        same_outcome_side: outcome.key,
        poly_hedge_side: 'OPPOSITE_YES',
        created_at: capturedAt,
        bookmaker_key: 'fonbet',
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

  return {
    bookmaker_inputs: bookmakerInputs,
    bookmaker_market_normalized: normalizedMarkets,
    market_pairs: marketPairs,
  };
}

async function defaultFetchCandidates() {
  const line = await fonbet.fetchLine();
  return fonbet.extractMainWinnerCandidates(line);
}

async function fetchFonbetSnapshotCandidates({
  fetchJson,
  snapshotUrl = null,
  maxAgeMs = Number(process.env.FONBET_SNAPSHOT_MAX_AGE_MS || 15 * 60 * 1000),
  getSnapshot = getLatestSourceSnapshot,
} = {}) {
  const databaseSnapshot = await getSnapshot('fonbet');
  let payload = databaseSnapshot?.raw;
  if (!payload && fetchJson) payload = await fetchJson('test://fonbet-snapshot');
  if (!databaseSnapshot && !fetchJson) throw new Error('Fonbet snapshot is missing from Neon');
  if (databaseSnapshot && databaseSnapshot.status !== 'ok') throw new Error(databaseSnapshot.error || 'Fonbet snapshot is in error state');
  const capturedAt = databaseSnapshot?.captured_at || payload?.captured_at;
  if (!capturedAt || !Number.isFinite(Date.parse(capturedAt))) throw new Error('Fonbet snapshot has no valid captured_at');
  if (databaseSnapshot && Date.now() - Date.parse(capturedAt) > maxAgeMs) throw new Error(`Fonbet snapshot is stale (captured_at=${capturedAt})`);
  if (!payload || !Array.isArray(payload.candidates)) throw new Error('Fonbet snapshot payload is missing candidates[]');
  const candidates = payload.candidates.filter((candidate) => (
    candidate?.venue === 'fonbet'
    && ['baseball', 'ufc'].includes(candidate.sport)
    && Array.isArray(candidate.participants)
    && Array.isArray(candidate.outcomes)
    && Date.parse(candidate.start_at)
  )).map((candidate) => ({ ...candidate, source_mode: 'snapshot_feed' }));
  Object.defineProperty(candidates, 'feed_captured_at', { value: capturedAt, enumerable: false });
  Object.defineProperty(candidates, 'snapshot_url', { value: databaseSnapshot ? 'postgres:live_source_snapshots/fonbet' : snapshotUrl, enumerable: false });
  return candidates;
}

async function fetchLiveFonbetPolymarketSource({
  now = new Date(),
  overrides = {},
  fetchCandidates = fetchFonbetSnapshotCandidates,
  fetchEvents = fetchSportsEvents,
  enrich = enrichMarket,
} = {}) {
  const capturedAt = new Date().toISOString();
  const [fonbetCandidates, mlbEvents, ufcEvents] = await Promise.all([
    fetchCandidates(),
    fetchEvents('mlb'),
    fetchEvents('ufc'),
  ]);
  const matches = buildExactLiveMatches({
    fonbetCandidates,
    polymarketEvents: [...mlbEvents, ...ufcEvents],
    now,
  });
  const mappedMarkets = await Promise.all(matches.map((match) => enrich(match.polymarket)));
  const enrichedById = new Map(mappedMarkets.map((market) => [String(market.id), market]));
  const enrichedMatches = matches.map((match) => ({
    ...match,
    polymarket: {
      ...enrichedById.get(String(match.polymarket.id)),
      canonical_outcomes: match.polymarket.canonical_outcomes,
      parsed_outcomes: match.polymarket.parsed_outcomes,
    },
  }));
  const collections = buildLiveCollections(enrichedMatches, { capturedAt, overrides });
  const bySport = {};
  for (const match of matches) bySport[match.fonbet.sport] = (bySport[match.fonbet.sport] || 0) + 1;

  return {
    ...collections,
    mapped_markets: mappedMarkets,
    metadata: {
      source: fonbetCandidates.snapshot_url ? 'fonbet_snapshot_feed+polymarket_gamma_clob' : 'fonbet_public_client_line+polymarket_gamma_clob',
      captured_at: fonbetCandidates.feed_captured_at || capturedAt,
      snapshot_url: fonbetCandidates.snapshot_url || null,
      candidates: fonbetCandidates.length,
      matches: matches.length,
      matches_by_sport: bySport,
    },
  };
}

module.exports = {
  canonicalParticipant,
  defaultFetchCandidates,
  fetchFonbetSnapshotCandidates,
  buildExactLiveMatches,
  buildLiveCollections,
  fetchLiveFonbetPolymarketSource,
};
