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
