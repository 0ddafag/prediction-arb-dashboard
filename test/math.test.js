const test = require('node:test');
const assert = require('node:assert/strict');
const {
  impliedProbability,
  bookmakerThreshold,
  decimalOddsForTarget,
  deriveNoPriceViews,
  buildArbSnapshot,
} = require('../src/math');

test('impliedProbability and bookmakerThreshold derive expected values', () => {
  assert.equal(impliedProbability(2.5), 0.4);
  assert.equal(bookmakerThreshold(2.5), 0.6);
});

test('decimalOddsForTarget returns breakeven and target odds', () => {
  assert.equal(decimalOddsForTarget(0.4, 0), 1.6666666666666667);
  assert.ok(Math.abs(decimalOddsForTarget(0.4, 5) - 1.8181818181818181) < 1e-12);
  assert.equal(decimalOddsForTarget(0.98, 5), null);
});

test('deriveNoPriceViews handles missing market and calculates candidates', () => {
  assert.deepEqual(deriveNoPriceViews(null), {
    market_exec: null,
    limit_candidate: null,
    easy_limit_candidate: null,
    easy_limit_score: null,
    best_no_bid: null,
    best_no_ask: null,
  });

  const views = deriveNoPriceViews({
    bestBid: 0.61,
    bestAsk: 0.64,
    liquidityClob: 10000,
    volume24hr: 2000,
  });

  assert.equal(views.market_exec, 0.39);
  assert.equal(views.limit_candidate, 0.36);
  assert.equal(views.easy_limit_candidate, 0.37);
  assert.ok(views.easy_limit_score >= 0 && views.easy_limit_score <= 100);
});

test('buildArbSnapshot respects manual polymarket overrides for table experiments', () => {
  const snapshot = buildArbSnapshot(
    {
      pair_id: 'pair-test',
      poly_no_market_override: 0.41,
      poly_no_limit_override: 0.37,
    },
    {
      effective_decimal_odds: 2.5,
    },
    {
      bestBid: 0.61,
      bestAsk: 0.64,
      takerBaseFee: 0,
      liquidityClob: 10000,
      volume24hr: 2000,
    }
  );

  assert.equal(snapshot.poly_no_market_exec, 0.41);
  assert.equal(snapshot.poly_no_limit_candidate, 0.37);
  assert.equal(snapshot.poly_no_easy_limit_candidate, 0.37);
  assert.equal(snapshot.price_views.derived_market_exec, 0.39);
  assert.equal(snapshot.price_views.derived_limit_candidate, 0.36);
});

test('buildArbSnapshot uses same-outcome NO pricing for football 1X2 rows', () => {
  const snapshot = buildArbSnapshot(
    {
      pair_id: 'pair-football-draw',
      sport: 'football',
      market_family: 'football_1x2',
      settlement_scope: 'regulation',
      hedge_strategy: 'same_outcome_no',
      basis_risk: 'NONE',
      poly_outcome_index: 1,
    },
    { effective_decimal_odds: 3.4 },
    {
      takerBaseFee: 0,
      liquidityClob: 5000,
      volume24hr: 2500,
      token_price_views: [
        { buy: 0.51, sell: 0.53, mid: 0.52 },
        { buy: 0.27, sell: 0.29, mid: 0.28 },
        { buy: 0.20, sell: 0.22, mid: 0.21 },
      ],
    }
  );

  assert.equal(snapshot.poly_no_market_exec, 0.73);
  assert.equal(snapshot.poly_no_limit_candidate, 0.71);
  assert.equal(snapshot.price_views.selected_side, 'NO');
  assert.equal(snapshot.hedge_strategy, 'same_outcome_no');
  assert.equal(snapshot.basis_risk, 'NONE');
});

test('buildArbSnapshot preserves basketball overtime basis risk for categorized opportunities', () => {
  const snapshot = buildArbSnapshot(
    {
      pair_id: 'pair-basketball-ot-risk',
      sport: 'basketball',
      market_family: 'regulation_result',
      settlement_scope: 'regulation_vs_including_ot',
      hedge_strategy: 'opposite_yes',
      basis_risk: 'OVERTIME',
      poly_outcome_index: 0,
    },
    { effective_decimal_odds: 2.1 },
    {
      takerBaseFee: 0,
      liquidityClob: 5000,
      volume24hr: 2500,
      token_price_views: [{ buy: 0.49, sell: 0.5, mid: 0.495 }],
    }
  );

  assert.equal(snapshot.basis_risk, 'OVERTIME');
  assert.equal(snapshot.settlement_scope, 'regulation_vs_including_ot');
});

test('buildArbSnapshot can use a selected Polymarket outcome for two-way sports rows', () => {
  const snapshot = buildArbSnapshot(
    {
      pair_id: 'pair-mlb-away',
      poly_outcome_index: 1,
    },
    {
      effective_decimal_odds: 2.05,
    },
    {
      takerBaseFee: 0,
      liquidityClob: 10000,
      volume24hr: 2000,
      token_price_views: [
        { buy: 0.45, sell: 0.46, mid: 0.455 },
        { buy: 0.54, sell: 0.55, mid: 0.545 },
      ],
    }
  );

  assert.equal(snapshot.poly_no_market_exec, 0.55);
  assert.equal(snapshot.poly_no_limit_candidate, 0.54);
  assert.equal(snapshot.poly_no_easy_limit_candidate, 0.54);
  assert.equal(snapshot.price_views.derived_market_exec, 0.55);
  assert.equal(snapshot.price_views.derived_limit_candidate, 0.54);
});
