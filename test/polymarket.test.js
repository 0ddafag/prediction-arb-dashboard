const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchSportsEvents, normalizeClobBook } = require('../src/polymarket');

test('sports event discovery requests nearest events first', async () => {
  let requestedUrl;
  const nearTerm = { id: 'near-term-mlb', startDate: '2026-07-29T23:00:00Z' };
  const farFuture = { id: 'far-future-mlb', startDate: '2026-08-04T23:00:00Z' };

  const events = await fetchSportsEvents('mlb', {
    fetchJsonImpl: async (url) => {
      requestedUrl = new URL(url);
      return [nearTerm, farFuture];
    },
  });

  assert.equal(requestedUrl.searchParams.get('tag_slug'), 'mlb');
  assert.equal(requestedUrl.searchParams.get('order'), 'startDate');
  assert.equal(requestedUrl.searchParams.get('ascending'), 'true');
  assert.deepEqual(events, [nearTerm, farFuture]);
});

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
