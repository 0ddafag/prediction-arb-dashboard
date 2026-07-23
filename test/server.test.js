const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { once } = require('node:events');
const { createServer } = require('../server');
const { STORE_PATH } = require('../src/storage');

async function withServer(run) {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();

  try {
    await run(port);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test('server exposes health and data endpoints', async () => {
  await withServer(async (port) => {
    const healthResponse = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(healthResponse.status, 200);
    const health = await healthResponse.json();
    assert.equal(health.ok, true);

    const dataResponse = await fetch(`http://127.0.0.1:${port}/api/data`);
    assert.equal(dataResponse.status, 200);
    const payload = await dataResponse.json();
    assert.ok(Array.isArray(payload.arb_snapshots));
    assert.ok(payload.summary);
    assert.ok(payload.diagnostics);
  });
});

test('server persists bookmaker and polymarket inline overrides', async () => {
  const originalStore = fs.readFileSync(STORE_PATH, 'utf8');

  try {
    await withServer(async (port) => {
      const dataResponse = await fetch(`http://127.0.0.1:${port}/api/data`);
      const payload = await dataResponse.json();
      const row = payload.arb_snapshots[0];
      assert.ok(row);

      const oddsResponse = await fetch(
        `http://127.0.0.1:${port}/api/markets/${encodeURIComponent(row.bookmaker_market.bookmaker_market_id)}/odds`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ edited_decimal_odds: 2.77 }),
        }
      );
      assert.equal(oddsResponse.status, 200);

      const polyResponse = await fetch(
        `http://127.0.0.1:${port}/api/pairs/${encodeURIComponent(row.pair_id)}/prices`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            poly_no_market_override: 0.44,
            poly_no_limit_override: 0.41,
          }),
        }
      );
      assert.equal(polyResponse.status, 200);

      const reloaded = await fetch(`http://127.0.0.1:${port}/api/data`);
      const nextPayload = await reloaded.json();
      const updated = nextPayload.arb_snapshots.find((item) => item.pair_id === row.pair_id);
      assert.equal(updated.bookmaker_market.effective_decimal_odds, 2.77);
      assert.equal(updated.poly_no_market_exec, 0.44);
      assert.equal(updated.poly_no_limit_candidate, 0.41);
      assert.equal(updated.price_views.derived_market_exec != null, true);
    });
  } finally {
    fs.writeFileSync(STORE_PATH, originalStore, 'utf8');
  }
});
