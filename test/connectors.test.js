const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeBookmakerRow } = require('../src/connectors/bookmakers/normalize');
const { getBookmakerConnector, listBookmakerConnectors } = require('../src/connectors/bookmakers');
const { extractMainWinnerCandidates } = require('../src/connectors/bookmakers/fonbet');
const { extractPublicSitemapEvents } = require('../src/connectors/bookmakers/ligastavok');

test('bookmaker connector registry is extensible across requested venues', () => {
  assert.deepEqual(listBookmakerConnectors().map((item) => item.key), ['winline', 'fonbet', 'ligastavok']);
  assert.equal(getBookmakerConnector('winline').status, 'active');
  assert.equal(getBookmakerConnector('fonbet').status, 'research');
  assert.equal(getBookmakerConnector('ligastavok').status, 'research');
});

test('normalizer emits canonical fields without fuzzy matching', () => {
  const row = normalizeBookmakerRow({
    venue: 'winline',
    sport: 'football',
    geo: 'GB',
    competition: 'Premier League',
    event_ref: 'evt-1',
    event_title: 'Arsenal — Chelsea',
    participants: ['Arsenal', 'Chelsea'],
    start_at: '2026-08-01T15:00:00Z',
    market_family: 'football_1x2',
    settlement_scope: 'regulation',
    outcome_key: 'draw',
    outcome_label: 'Draw',
    decimal_odds: '3.40',
    source_url: 'https://example.test/event/1',
    captured_at: '2026-07-27T00:00:00Z',
  });

  assert.equal(row.venue, 'winline');
  assert.equal(row.sport, 'football');
  assert.equal(row.outcome_key, 'draw');
  assert.equal(row.decimal_odds, 3.4);
  assert.equal(row.matching_mode, 'exact_only');
});

test('normalizer rejects incomplete or invalid odds rows', () => {
  assert.throws(() => normalizeBookmakerRow({ venue: 'winline' }), /sport/);
  assert.throws(() => normalizeBookmakerRow({
    venue: 'winline', sport: 'baseball', geo: 'US', competition: 'MLB', event_ref: 'e', event_title: 'A — B',
    participants: ['A', 'B'], start_at: '2026-07-27T00:00:00Z', market_family: 'moneyline_2way',
    settlement_scope: 'full_game', outcome_key: 'a', outcome_label: 'A', decimal_odds: 1,
    source_url: 'https://example.test', captured_at: '2026-07-27T00:00:00Z',
  }), /decimal_odds/);
});

test('Winline connector exposes only confirmed coverage during normal sync', () => {
  const connector = getBookmakerConnector('winline');
  const rules = connector.coverage({ sport: 'baseball', mode: 'sync' });
  assert.equal(rules.length, 1);
  assert.equal(rules[0].competition, 'MLB');
  assert.deepEqual(connector.coverage({ sport: 'football', mode: 'sync' }), []);
  assert.equal(connector.coverage({ sport: 'football', mode: 'audit' }).length, 1);
});

test('Fonbet public line candidates preserve provider IDs and exact 1X2 outcomes', () => {
  const payload = {
    packetVersion: 99,
    sports: [
      { id: 1, kind: 'sport', name: 'Футбол', alias: 'football' },
      { id: 80073, parentId: 1, kind: 'segment', name: 'Россия. 1-я лига' },
    ],
    events: [
      { id: 10, sportId: 80073, kind: 1, team1: 'КАМАЗ', team2: 'Ротор', startTime: 1785171600 },
      { id: 11, parentId: 10, sportId: 80073, kind: 100201, name: '1-й тайм', startTime: 1785171600 },
    ],
    customFactors: [{ e: 10, factors: [{ f: 921, v: 3.05 }, { f: 922, v: 3 }, { f: 923, v: 2.45 }] }],
  };

  const rows = extractMainWinnerCandidates(payload);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].provider_event_id, 10);
  assert.equal(rows[0].sport, 'football');
  assert.equal(rows[0].competition, 'Россия. 1-я лига');
  assert.equal(rows[0].market_family_hint, 'football_1x2');
  assert.deepEqual(rows[0].outcomes.map((outcome) => [outcome.factor_id, outcome.key, outcome.decimal_odds]), [
    [921, 'home', 3.05], [922, 'draw', 3], [923, 'away', 2.45],
  ]);
});

test('Fonbet UFC candidate is not misrepresented as risk-free two-way when draw is quoted', () => {
  const payload = {
    packetVersion: 100,
    sports: [
      { id: 37145, kind: 'sport', name: 'Единоборства', alias: 'mix-fights' },
      { id: 144501, parentId: 37145, kind: 'segment', name: 'MMA. UFC 330' },
    ],
    events: [{ id: 20, sportId: 144501, kind: 1, team1: 'Fighter A', team2: 'Fighter B', startTime: 1786852800 }],
    customFactors: [{ e: 20, factors: [{ f: 921, v: 1.25 }, { f: 922, v: 65 }, { f: 923, v: 4.15 }] }],
  };

  const [row] = extractMainWinnerCandidates(payload);
  assert.equal(row.sport, 'ufc');
  assert.equal(row.market_family_hint, 'combat_1x2');
  assert.deepEqual(row.risk_hints, ['DRAW_NO_CONTEST']);
});

test('Liga Stavok public sitemap discovery preserves event and service IDs without inventing odds', () => {
  const xml = `<?xml version="1.0"?><urlset>
    <url><loc>https://www.ligastavok.ru/sports/baseball/oclend-atletiks-boston-red-soks-id-23400090-service-id-26-ext-id-919570</loc></url>
    <url><loc>https://www.ligastavok.ru/sports/combats/dern-m-robertson-dzh-id-23342195-service-id-26-ext-id-876582</loc></url>
    <url><loc>https://www.ligastavok.ru/sports/soccer/arsenal-tula-torpedo-id-23395210-service-id-26-ext-id-1002624</loc></url>
  </urlset>`;

  assert.deepEqual(extractPublicSitemapEvents(xml, ['baseball', 'combats']), [
    {
      sport: 'baseball',
      slug: 'oclend-atletiks-boston-red-soks',
      provider_event_id: 23400090,
      service_id: 26,
      external_event_id: 919570,
      source_url: 'https://www.ligastavok.ru/sports/baseball/oclend-atletiks-boston-red-soks-id-23400090-service-id-26-ext-id-919570',
      decimal_odds: null,
    },
    {
      sport: 'combats',
      slug: 'dern-m-robertson-dzh',
      provider_event_id: 23342195,
      service_id: 26,
      external_event_id: 876582,
      source_url: 'https://www.ligastavok.ru/sports/combats/dern-m-robertson-dzh-id-23342195-service-id-26-ext-id-876582',
      decimal_odds: null,
    },
  ]);
});
