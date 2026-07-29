const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeSources } = require('../src/live-sportsbook-polymarket');
const { runRequest } = require('../scripts/winline-refresh-worker');

test('multi-source merge retains both bookmaker keys and source diagnostics', () => {
  const result = mergeSources([
    { status: 'fulfilled', source: 'winline', value: {
      bookmaker_inputs: [{ input_id: 'w' }],
      bookmaker_market_normalized: [{ bookmaker_key: 'winline' }],
      market_pairs: [], mapped_markets: [],
      metadata: { source: 'winline_snapshot_feed+polymarket_gamma_clob', captured_at: '2026-08-01T12:00:00Z' },
    } },
    { status: 'fulfilled', source: 'fonbet', value: {
      bookmaker_inputs: [{ input_id: 'f' }],
      bookmaker_market_normalized: [{ bookmaker_key: 'fonbet' }],
      market_pairs: [], mapped_markets: [],
      metadata: { source: 'fonbet_snapshot_feed+polymarket_gamma_clob', captured_at: '2026-08-01T12:01:00Z' },
    } },
    { status: 'rejected', source: 'other', reason: new Error('missing') },
  ]);
  assert.deepEqual(result.bookmaker_market_normalized.map((row) => row.bookmaker_key), ['winline', 'fonbet']);
  assert.equal(result.metadata.source_status.winline.status, 'ok');
  assert.equal(result.metadata.source_status.fonbet.status, 'ok');
  assert.match(result.metadata.warnings[0], /^other: missing$/);
});

test('refresh worker runs both feeds sequentially and records per-source results', async () => {
  const commands = [];
  let completion;
  await runRequest({ id: 42 }, {
    exec: async (_command, args) => {
      commands.push(args.join(' '));
      return { stdout: JSON.stringify({ source: args[1].split(':')[0], status: 'ok' }), stderr: '' };
    },
    complete: async (_id, status, details) => { completion = { status, details }; },
  });
  assert.deepEqual(commands, ['run winline:feed', 'run fonbet:feed']);
  assert.equal(completion.status, 'succeeded');
  assert.deepEqual(Object.keys(completion.details.result.sources), ['winline', 'fonbet']);
});
