const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeKalshiOrderbook,
  estimateKalshiFee,
  kalshiConnector,
} = require('../src/connectors/prediction/kalshi');
const {
  normalizePredictOrderbook,
  estimatePredictFee,
  predictFunConnector,
} = require('../src/connectors/prediction/predictfun');


test('Kalshi derives taker asks from complementary YES/NO bids', () => {
  const normalized = normalizeKalshiOrderbook({
    orderbook_fp: {
      yes_dollars: [['0.5400', '100.00'], ['0.5300', '50.00']],
      no_dollars: [['0.4500', '80.00'], ['0.4400', '20.00']],
    },
  });

  assert.equal(normalized.yes.best_bid, 0.54);
  assert.equal(normalized.yes.best_ask, 0.55);
  assert.equal(normalized.no.best_bid, 0.45);
  assert.equal(normalized.no.best_ask, 0.46);
  assert.equal(normalized.source_semantics, 'yes_and_no_bids');
});


test('Kalshi fee estimator supports market-specific coefficient and rounding increment', () => {
  assert.equal(estimateKalshiFee({ contracts: 100, price: 0.5 }), 1.75);
  assert.equal(estimateKalshiFee({ contracts: 100, price: 0.5, coefficient: 0.0175 }), 0.44);
  assert.equal(estimateKalshiFee({ contracts: 1, price: 0.5, roundingIncrement: 0.0001 }), 0.0175);
});


test('Predict orderbook stores YES prices and derives NO depth by complement', () => {
  const normalized = normalizePredictOrderbook({
    success: true,
    data: {
      marketId: 123,
      asks: [[0.62, 1500], [0.63, 800]],
      bids: [[0.61, 2000], [0.60, 1200]],
    },
  }, 2);

  assert.equal(normalized.yes.best_bid, 0.61);
  assert.equal(normalized.yes.best_ask, 0.62);
  assert.equal(normalized.no.best_bid, 0.38);
  assert.equal(normalized.no.best_ask, 0.39);
  assert.deepEqual(normalized.no.asks[0], [0.39, 2000]);
});


test('Predict fee estimator applies market bps and optional discount', () => {
  assert.equal(estimatePredictFee({ shares: 100, price: 0.2, takerFeeBps: 200 }), 0.4);
  assert.equal(estimatePredictFee({ shares: 100, price: 0.2, takerFeeBps: 200, discountFactor: 0.9 }), 0.36);
});


test('prediction connector metadata does not pretend authenticated books are public', () => {
  assert.equal(kalshiConnector.discovery.authentication, 'public');
  assert.equal(kalshiConnector.orderbook.authentication, 'rsa_api_key');
  assert.equal(predictFunConnector.discovery.authentication, 'public_undocumented_graphql');
  assert.equal(predictFunConnector.orderbook.authentication, 'api_key');
});
