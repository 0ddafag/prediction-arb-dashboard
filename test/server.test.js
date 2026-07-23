const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createServer } = require('../server');

test('server exposes health and data endpoints', async () => {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const { port } = server.address();

  try {
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
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
