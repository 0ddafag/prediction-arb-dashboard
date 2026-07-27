const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  STORE_PATH,
  readStore,
  updateLiveBookmakerOverride,
  updateLivePairOverride,
} = require('../src/storage');

test('live Fonbet and Polymarket overrides persist separately from seeded snapshots', () => {
  const original = fs.readFileSync(STORE_PATH, 'utf8');
  try {
    updateLiveBookmakerOverride('bm-live-fonbet-101-921', 2.77);
    updateLivePairOverride('pair-live-fonbet-101-921', {
      poly_no_market_override: 0.44,
      poly_no_limit_override: 0.41,
      poly_no_easy_override: null,
    });

    const store = readStore();
    assert.equal(store.live_overrides.bookmaker_odds['bm-live-fonbet-101-921'], 2.77);
    assert.deepEqual(store.live_overrides.pair_prices['pair-live-fonbet-101-921'], {
      poly_no_market_override: 0.44,
      poly_no_limit_override: 0.41,
      poly_no_easy_override: null,
    });
  } finally {
    fs.writeFileSync(STORE_PATH, original, 'utf8');
  }
});
