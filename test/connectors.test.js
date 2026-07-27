const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeBookmakerRow } = require('../src/connectors/bookmakers/normalize');
const { getBookmakerConnector, listBookmakerConnectors } = require('../src/connectors/bookmakers');

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
