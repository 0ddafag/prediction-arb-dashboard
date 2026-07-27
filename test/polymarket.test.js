const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeClobBook } = require('../src/polymarket');

test('Polymarket CLOB books use highest bid and lowest ask as executable top of book', () => {
  const view = normalizeClobBook({
    bids: [
      { price: '0.39', size: '50' },
      { price: '0.41', size: '25' },
    ],
    asks: [
      { price: '0.45', size: '20' },
      { price: '0.43', size: '12' },
    ],
  });

  assert.deepEqual(view, {
    best_bid: 0.41,
    best_bid_size: 25,
    best_ask: 0.43,
    best_ask_size: 12,
  });
});
