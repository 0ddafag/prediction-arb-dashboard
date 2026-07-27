const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SPORTS,
  HEDGE_STRATEGIES,
  BASIS_RISKS,
  defaultHedgeStrategy,
  validateMapping,
} = require('../src/domain');
const { getBookmakerLabel, listBookmakers } = require('../src/bookmaker');
const { classifyOpportunity, sortTopOpportunities } = require('../src/opportunities');

test('bookmaker registry exposes production labels', () => {
  assert.equal(getBookmakerLabel('winline'), 'Winline');
  assert.equal(getBookmakerLabel('fonbet'), 'Fonbet');
  assert.equal(getBookmakerLabel('ligastavok'), 'Liga Stavok');
  assert.deepEqual(listBookmakers().map((item) => item.key), ['winline', 'fonbet', 'ligastavok']);
});

test('sport defaults encode the requested hedge semantics', () => {
  assert.equal(defaultHedgeStrategy(SPORTS.BASEBALL, 'moneyline_2way'), HEDGE_STRATEGIES.OPPOSITE_YES);
  assert.equal(defaultHedgeStrategy(SPORTS.UFC, 'moneyline_2way'), HEDGE_STRATEGIES.OPPOSITE_YES);
  assert.equal(defaultHedgeStrategy(SPORTS.TENNIS, 'moneyline_2way'), HEDGE_STRATEGIES.OPPOSITE_YES);
  assert.equal(defaultHedgeStrategy(SPORTS.FOOTBALL, 'football_1x2'), HEDGE_STRATEGIES.SAME_OUTCOME_NO);
  assert.equal(defaultHedgeStrategy(SPORTS.BASKETBALL, 'match_winner_including_ot'), HEDGE_STRATEGIES.OPPOSITE_YES);
});

test('mapping validation requires explicit supported semantics', () => {
  assert.doesNotThrow(() => validateMapping({
    sport: SPORTS.FOOTBALL,
    market_family: 'football_1x2',
    settlement_scope: 'regulation',
    hedge_strategy: HEDGE_STRATEGIES.SAME_OUTCOME_NO,
    basis_risk: BASIS_RISKS.NONE,
  }));

  assert.throws(() => validateMapping({
    sport: SPORTS.FOOTBALL,
    market_family: 'football_1x2',
    settlement_scope: 'regulation',
    hedge_strategy: HEDGE_STRATEGIES.OPPOSITE_YES,
    basis_risk: BASIS_RISKS.NONE,
  }), /same_outcome_no/);
});

test('top opportunities categorize market, limit and basis risk rows', () => {
  assert.equal(classifyOpportunity({ net_edge_market: 0.03, net_edge_limit: 0.05, pair: { basis_risk: 'NONE' } }), 'market');
  assert.equal(classifyOpportunity({ net_edge_market: -0.01, net_edge_limit: 0.04, pair: { basis_risk: 'NONE' } }), 'limit');
  assert.equal(classifyOpportunity({ net_edge_market: 0.02, net_edge_limit: 0.04, pair: { basis_risk: 'OVERTIME' } }), 'basis_risk');
  assert.equal(classifyOpportunity({ net_edge_market: -0.02, net_edge_limit: -0.01, pair: { basis_risk: 'RETIREMENT' } }), null);
});

test('top opportunities sort by category priority then relevant edge descending', () => {
  const sorted = sortTopOpportunities([
    { pair_id: 'limit-low', net_edge_market: -0.01, net_edge_limit: 0.02, pair: { basis_risk: 'NONE' } },
    { pair_id: 'risk-high', net_edge_market: 0.09, net_edge_limit: 0.1, pair: { basis_risk: 'DRAW_NO_CONTEST' } },
    { pair_id: 'market-low', net_edge_market: 0.01, net_edge_limit: 0.02, pair: { basis_risk: 'NONE' } },
    { pair_id: 'market-high', net_edge_market: 0.04, net_edge_limit: 0.05, pair: { basis_risk: 'NONE' } },
    { pair_id: 'negative', net_edge_market: -0.02, net_edge_limit: -0.01, pair: { basis_risk: 'NONE' } },
  ]);

  assert.deepEqual(sorted.map((item) => item.pair_id), ['market-high', 'market-low', 'limit-low', 'risk-high']);
  assert.deepEqual(sorted.map((item) => item.opportunity_category), ['market', 'market', 'limit', 'basis_risk']);
});
