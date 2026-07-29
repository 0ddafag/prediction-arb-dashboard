const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { once } = require('node:events');
process.env.LIVE_DATA_MODE = 'seed';
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
    assert.equal(payload.arb_snapshots.every((row) => row.bookmaker_market.bookmaker_key === 'winline'), true);
    assert.equal(payload.arb_snapshots.every((row) => row.bookmaker_label === 'Winline'), true);
    assert.deepEqual(payload.filters.sports.map((item) => item.key), ['baseball', 'ufc', 'tennis', 'football', 'basketball']);
    assert.deepEqual(payload.filters.bookmakers.map((item) => item.key), ['winline', 'fonbet', 'ligastavok']);
  });
});

test('server exposes safe Postgres-backed state fallback without DATABASE_URL', async () => {
  await withServer(async (port) => {
    const stateResponse = await fetch(`http://127.0.0.1:${port}/api/state`);
    assert.equal(stateResponse.status, 200);
    const state = await stateResponse.json();
    assert.deepEqual(state.settings, {});
    assert.deepEqual(state.live_overrides, { bookmaker_odds: {}, pair_prices: {} });

    const settingResponse = await fetch(`http://127.0.0.1:${port}/api/state/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'cashStakeRub', value: '2000' }),
    });
    assert.equal(settingResponse.status, 200);
    const setting = await settingResponse.json();
    assert.equal(setting.updated.persisted, false);
  });
});

test('server exposes filtered and categorized opportunities', async () => {
  await withServer(async (port) => {
    const footballResponse = await fetch(`http://127.0.0.1:${port}/api/opportunities?sport=football`);
    assert.equal(footballResponse.status, 200);
    const football = await footballResponse.json();
    assert.deepEqual(football.rows, []);
    assert.equal(football.summary.rows, 0);

    const topResponse = await fetch(`http://127.0.0.1:${port}/api/opportunities?view=top`);
    assert.equal(topResponse.status, 200);
    const top = await topResponse.json();
    assert.ok(Array.isArray(top.rows));
    assert.equal(top.rows.every((row) => ['market', 'limit', 'basis_risk'].includes(row.opportunity_category)), true);
    assert.deepEqual(top.filters.bookmakers.map((item) => item.label), ['Winline', 'Fonbet', 'Liga Stavok']);
  });
});

test('server exposes multi-sport and bookmaker tab shell', async () => {
  await withServer(async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /id="sportTabs"/);
    assert.match(html, /id="bookmakerTabs"/);
    assert.match(html, /Prediction arb dashboard/);
    assert.doesNotMatch(html, /MLB arb table/);
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

test('server accepts manual overrides for dynamic live row ids', async () => {
  const originalStore = fs.readFileSync(STORE_PATH, 'utf8');
  try {
    await withServer(async (port) => {
      const oddsResponse = await fetch('http://127.0.0.1:' + port + '/api/markets/bm-live-fonbet-101-921/odds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edited_decimal_odds: 2.77 }),
      });
      assert.equal(oddsResponse.status, 200);

      const pairResponse = await fetch('http://127.0.0.1:' + port + '/api/pairs/pair-live-fonbet-101-921/prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ poly_no_market_override: 0.44, poly_no_limit_override: 0.41 }),
      });
      assert.equal(pairResponse.status, 200);
    });
  } finally {
    fs.writeFileSync(STORE_PATH, originalStore, 'utf8');
  }
});

test('server reports that manual Winline refresh is not configured', async () => {
  const originalUrl = process.env.WINLINE_COLLECTOR_WEBHOOK_URL;
  const originalToken = process.env.WINLINE_COLLECTOR_WEBHOOK_TOKEN;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.WINLINE_COLLECTOR_WEBHOOK_URL;
  delete process.env.WINLINE_COLLECTOR_WEBHOOK_TOKEN;
  delete process.env.DATABASE_URL;

  try {
    await withServer(async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/winline/refresh`, { method: 'POST' });
      assert.equal(response.status, 501);
      assert.deepEqual(await response.json(), {
        ok: false,
        status: 'not_configured',
        message: 'Winline manual refresh is not configured',
      });
    });
  } finally {
    if (originalUrl === undefined) delete process.env.WINLINE_COLLECTOR_WEBHOOK_URL;
    else process.env.WINLINE_COLLECTOR_WEBHOOK_URL = originalUrl;
    if (originalToken === undefined) delete process.env.WINLINE_COLLECTOR_WEBHOOK_TOKEN;
    else process.env.WINLINE_COLLECTOR_WEBHOOK_TOKEN = originalToken;
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

test('server queues manual Winline refresh in Neon when webhook is absent', async () => {
  const storage = require('../src/storage/postgres-store');
  const originalUrl = process.env.WINLINE_COLLECTOR_WEBHOOK_URL;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalEnqueue = storage.enqueueWinlineRefresh;
  delete process.env.WINLINE_COLLECTOR_WEBHOOK_URL;
  process.env.DATABASE_URL = 'postgresql://test.invalid/prediction';
  storage.enqueueWinlineRefresh = async () => ({ id: 42, status: 'pending', requested_at: '2026-07-29T12:00:00.000Z' });

  try {
    await withServer(async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/winline/refresh`, { method: 'POST' });
      assert.equal(response.status, 202);
      assert.deepEqual(await response.json(), {
        ok: true,
        status: 'queued',
        message: 'Book refresh queued',
        request_id: 42,
        request: { id: 42, status: 'pending', requested_at: '2026-07-29T12:00:00.000Z' },
      });
    });
  } finally {
    storage.enqueueWinlineRefresh = originalEnqueue;
    if (originalUrl === undefined) delete process.env.WINLINE_COLLECTOR_WEBHOOK_URL;
    else process.env.WINLINE_COLLECTOR_WEBHOOK_URL = originalUrl;
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }
});
test('server triggers the configured Winline collector webhook', async () => {
  const collector = require('node:http').createServer((req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.headers.authorization, 'Bearer test-token');
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ accepted: true, job_id: 'safe-job-id' }));
  });
  collector.listen(0, '127.0.0.1');
  await once(collector, 'listening');
  const { port: collectorPort } = collector.address();
  const originalUrl = process.env.WINLINE_COLLECTOR_WEBHOOK_URL;
  const originalToken = process.env.WINLINE_COLLECTOR_WEBHOOK_TOKEN;
  process.env.WINLINE_COLLECTOR_WEBHOOK_URL = `http://127.0.0.1:${collectorPort}/winline-refresh`;
  process.env.WINLINE_COLLECTOR_WEBHOOK_TOKEN = 'test-token';

  try {
    await withServer(async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/winline/refresh`, { method: 'POST' });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        ok: true,
        status: 'success',
        message: 'Winline collector refresh triggered',
        collector: { status: 202, body: { accepted: true, job_id: 'safe-job-id' } },
      });
    });
  } finally {
    await new Promise((resolve, reject) => collector.close((error) => (error ? reject(error) : resolve())));
    if (originalUrl === undefined) delete process.env.WINLINE_COLLECTOR_WEBHOOK_URL;
    else process.env.WINLINE_COLLECTOR_WEBHOOK_URL = originalUrl;
    if (originalToken === undefined) delete process.env.WINLINE_COLLECTOR_WEBHOOK_TOKEN;
    else process.env.WINLINE_COLLECTOR_WEBHOOK_TOKEN = originalToken;
  }
});
