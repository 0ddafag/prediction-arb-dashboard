const { createBookmakerConnector } = require('./base');

const DEFAULT_LINE_BASE_URL = 'https://line-lb51.bk6bba-resources.com';
const ROOT_SPORTS = Object.freeze({
  1: { sport: 'football', risk_hints: [] },
  3: { sport: 'basketball', risk_hints: ['OVERTIME_SCOPE'] },
  4: { sport: 'tennis', risk_hints: ['RETIREMENT'] },
  5: { sport: 'baseball', risk_hints: ['CANCELLATION_POSTPONEMENT'] },
  37145: { sport: 'ufc', risk_hints: ['DRAW_NO_CONTEST'] },
});
const MAIN_OUTCOMES = Object.freeze({
  921: 'home',
  922: 'draw',
  923: 'away',
});

function lineBaseUrl() {
  return process.env.FONBET_LINE_BASE_URL || DEFAULT_LINE_BASE_URL;
}

async function fetchFonbetLine({ scopeMarket = 1600, lang = 'ru', fetchImpl = fetch } = {}) {
  const url = new URL('/events/listBase', lineBaseUrl());
  url.searchParams.set('scopeMarket', String(scopeMarket));
  url.searchParams.set('lang', lang);
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Fonbet line request failed: ${response.status}`);
  return response.json();
}

async function fetchFonbetEvent(eventId, { scopeMarket = 1600, lang = 'ru', fetchImpl = fetch } = {}) {
  const url = new URL('/events/event', lineBaseUrl());
  url.searchParams.set('eventId', String(eventId));
  url.searchParams.set('scopeMarket', String(scopeMarket));
  url.searchParams.set('lang', lang);
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Fonbet event request failed: ${response.status}`);
  return response.json();
}

function buildSportIndex(sports = []) {
  return new Map(sports.map((sport) => [Number(sport.id), sport]));
}

function findRootSport(sportId, sportIndex) {
  let current = sportIndex.get(Number(sportId));
  const seen = new Set();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.kind === 'sport') return current;
    current = sportIndex.get(Number(current.parentId));
  }
  return null;
}

function marketMetadata(sport, hasDraw) {
  if (sport === 'football') return { market_family_hint: 'football_1x2', settlement_scope_hint: 'regulation' };
  if (sport === 'basketball' && hasDraw) {
    return { market_family_hint: 'basketball_regulation_1x2', settlement_scope_hint: 'regulation' };
  }
  if (sport === 'basketball') {
    return { market_family_hint: 'basketball_full_game_moneyline', settlement_scope_hint: 'full_game_including_overtime' };
  }
  if (sport === 'baseball') return { market_family_hint: 'moneyline_2way', settlement_scope_hint: 'full_game' };
  if (sport === 'tennis') return { market_family_hint: 'match_winner_2way', settlement_scope_hint: 'full_match' };
  if (sport === 'ufc' && hasDraw) return { market_family_hint: 'combat_1x2', settlement_scope_hint: 'full_fight' };
  if (sport === 'ufc') return { market_family_hint: 'combat_winner_2way', settlement_scope_hint: 'full_fight' };
  return { market_family_hint: 'winner', settlement_scope_hint: 'unknown' };
}

function extractMainWinnerCandidates(payload) {
  const sportIndex = buildSportIndex(payload?.sports || []);
  const factorsByEvent = new Map((payload?.customFactors || []).map((entry) => [Number(entry.e), entry.factors || []]));
  const rows = [];

  for (const event of payload?.events || []) {
    if (event.kind !== 1 || event.parentId != null || !event.team1 || !event.team2) continue;
    const root = findRootSport(event.sportId, sportIndex);
    const rootConfig = ROOT_SPORTS[Number(root?.id)];
    if (!rootConfig) continue;

    const sourceFactors = factorsByEvent.get(Number(event.id)) || [];
    const outcomes = sourceFactors
      .filter((factor) => MAIN_OUTCOMES[factor.f] && Number(factor.v) > 1)
      .map((factor) => ({
        factor_id: Number(factor.f),
        key: MAIN_OUTCOMES[factor.f],
        label: factor.f === 921 ? event.team1 : factor.f === 923 ? event.team2 : 'Draw',
        decimal_odds: Number(factor.v),
        parameter: factor.pt ?? null,
      }));
    if (outcomes.length < 2) continue;

    const segment = sportIndex.get(Number(event.sportId));
    const hasDraw = outcomes.some((outcome) => outcome.key === 'draw');
    const hints = rootConfig.risk_hints.filter((risk) => {
      if (risk === 'DRAW_NO_CONTEST') return hasDraw;
      if (risk === 'OVERTIME_SCOPE') return true;
      return true;
    });

    rows.push({
      venue: 'fonbet',
      provider_event_id: Number(event.id),
      provider_sport_id: Number(event.sportId),
      root_sport_id: Number(root.id),
      sport: rootConfig.sport,
      competition: segment?.name || '',
      participants: [String(event.team1), String(event.team2)],
      start_at: new Date(Number(event.startTime) * 1000).toISOString(),
      ...marketMetadata(rootConfig.sport, hasDraw),
      outcomes,
      risk_hints: hints,
      packet_version: payload.packetVersion ?? null,
      source_url: `${lineBaseUrl()}/events/event?eventId=${encodeURIComponent(event.id)}&lang=ru&scopeMarket=1600`,
      matching_mode: 'exact_only',
    });
  }

  return rows;
}

const baseConnector = createBookmakerConnector({
  key: 'fonbet',
  label: 'Fonbet',
  status: 'research',
  notes: 'Public read-only line and event JSON confirmed; exact coverage and settlement mappings are not yet production-approved.',
});

module.exports = Object.freeze({
  ...baseConnector,
  transport: Object.freeze({
    type: 'public_json',
    base_url: DEFAULT_LINE_BASE_URL,
    line_path: '/events/listBase',
    event_path: '/events/event',
    authentication: 'none_observed',
    website_access: 'captcha_or_ip_challenge_from_current_host',
  }),
  fetchLine: fetchFonbetLine,
  fetchEvent: fetchFonbetEvent,
  extractMainWinnerCandidates,
  constants: Object.freeze({ ROOT_SPORTS, MAIN_OUTCOMES }),
});
