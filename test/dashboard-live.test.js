const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDashboardPayload, countDistinctMatches } = require('../src/dashboard');

function liveSource() {
  return {
    bookmaker_inputs: [{
      input_id: 'live-input',
      bookmaker_key: 'fonbet',
      source_mode: 'browser_public_transport',
      source_ref: 'https://fonbet.test',
      captured_at: '2026-07-27T20:00:00Z',
      review_status: 'mapped',
    }],
    bookmaker_market_normalized: [{
      bookmaker_market_id: 'live-market',
      input_id: 'live-input',
      bookmaker_key: 'fonbet',
      event_title: 'Detroit — Baltimore',
      event_start_at: '2026-07-27T22:40:00Z',
      sport: 'baseball',
      market_type: 'moneyline_2way',
      market_family: 'moneyline_2way',
      outcome_key: 'home',
      outcome_label: 'Detroit',
      captured_decimal_odds: 2.5,
      edited_decimal_odds: null,
      effective_decimal_odds: 2.5,
      source_mode: 'browser_public_transport',
    }],
    market_pairs: [{
      pair_id: 'live-pair',
      bookmaker_market_id: 'live-market',
      poly_market_id: 'poly-live',
      poly_outcome_index: 0,
      bookmaker_key: 'fonbet',
      sport: 'baseball',
      market_family: 'moneyline_2way',
      settlement_scope: 'full_game',
      hedge_strategy: 'opposite_yes',
      basis_risk: 'RULES_MISMATCH',
      mapping_status: 'mapped',
    }],
    mapped_markets: [{
      id: 'poly-live',
      token_price_views: [{ buy: 0.39, sell: 0.4, mid: 0.395 }],
      feeSchedule: { rate: 0.05 },
      liquidityClob: 1000,
      volume24hr: 500,
    }],
    metadata: {
      source: 'fonbet_public_client_line+polymarket_gamma_clob',
      captured_at: '2026-07-27T20:00:00Z',
      matches: 1,
      matches_by_sport: { baseball: 1 },
    },
  };
}

test('dashboard live mode exposes only current exact Fonbet intersections', async () => {
  const payload = await buildDashboardPayload({
    dataMode: 'live',
    liveFetcher: async () => liveSource(),
    featuredFetcher: async () => [],
  });

  assert.equal(payload.summary.source_mode, 'live');
  assert.equal(payload.summary.mapped_pairs, 1);
  assert.equal(payload.arb_snapshots.length, 1);
  assert.equal(payload.arb_snapshots[0].bookmaker_label, 'Fonbet');
  assert.equal(payload.arb_snapshots[0].bookmaker_market.bookmaker_key, 'fonbet');
  assert.equal(payload.filters.bookmakers.find((item) => item.key === 'fonbet').status, 'active');
  assert.equal(payload.diagnostics.live_data_ok, true);
  assert.deepEqual(payload.summary.matches_by_sport, { baseball: 1 });
});

test('match counts distinguish repeated team pairings on different provider events', () => {
  const common = { bookmaker_market: { event_title: 'Same teams' } };
  assert.equal(countDistinctMatches([
    { ...common, pair: { provider_event_id: 101 } },
    { ...common, pair: { provider_event_id: 101 } },
    { ...common, pair: { provider_event_id: 202 } },
  ]), 2);
});
