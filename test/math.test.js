const test = require('node:test');
const assert = require('node:assert/strict');
const {
  impliedProbability,
  bookmakerThreshold,
  decimalOddsForTarget,
  deriveNoPriceViews,
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
  assert.equal(views.limit_candidate, 0.375);
  assert.equal(views.easy_limit_candidate, 0.37);
  assert.ok(views.easy_limit_score >= 0 && views.easy_limit_score <= 100);
});
