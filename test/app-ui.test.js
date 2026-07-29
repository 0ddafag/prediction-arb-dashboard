const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadAppFunctions() {
  const code = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const sandbox = {
    window: { addEventListener() {} },
    document: {},
    Intl,
    Date,
    Number,
    Math,
    String,
    Set,
    Map,
    Array,
    Object,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

test('client match identity distinguishes repeated team pairings by provider event id', () => {
  const app = loadAppFunctions();
  const common = { bookmaker_market: { event_title: 'Same teams', event_start_at: '2026-07-27T22:40:00Z' } };
  assert.notEqual(
    app.clientMatchIdentity({ ...common, pair: { provider_event_id: 101 } }),
    app.clientMatchIdentity({ ...common, pair: { provider_event_id: 202 } })
  );
});

test('event start formatting makes repeated fixtures visually distinguishable', () => {
  const app = loadAppFunctions();
  const label = app.formatEventStart('2026-07-27T22:40:00Z');
  assert.match(label, /27/);
  assert.match(label, /22:40/);
});

test('market display preserves fee-inclusive fractional cents while limit stays compact', () => {
  const app = loadAppFunctions();
  assert.equal(app.formatMarketDisplayInput(0.3411), '34.11');
  assert.equal(app.formatPercentPrice(0.3411), '34.11%');
  assert.equal(app.formatLimitDisplayInput(0.34), '34');
});

test('client exposes the manual Winline refresh flow', () => {
  const app = loadAppFunctions();
  assert.equal(typeof app.refreshWinline, 'function');
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8'), /id="winlineRefreshButton"/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8'), /waiting for VPS worker/);
});
