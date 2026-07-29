const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildStoreSnapshotRows,
  isPostgresConfigured,
} = require('../src/storage/postgres-store');

test('Postgres migration transformer preserves current mapped MLB rows', () => {
  const store = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'store.json'), 'utf8'));
  const rows = buildStoreSnapshotRows(store);
  assert.equal(rows.bookmakerMarkets.length, 24);
  assert.equal(rows.marketMappings.length, 24);
  assert.equal(rows.bookmakerMarkets.every((row) => row.bookmaker_key === 'winline'), true);
  assert.equal(rows.marketMappings.every((row) => row.sport === 'baseball'), true);
  assert.equal(rows.marketMappings.every((row) => row.hedge_strategy === 'opposite_yes'), true);
});

test('Postgres configuration is enabled only by a non-empty DATABASE_URL', () => {
  assert.equal(isPostgresConfigured({}), false);
  assert.equal(isPostgresConfigured({ DATABASE_URL: '' }), false);
  assert.equal(isPostgresConfigured({ DATABASE_URL: 'postgresql://example.invalid/db' }), true);
});

test('Neon migration guards legacy target_type reads for partial legacy schemas', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '003_neon_winline_pipeline.sql'), 'utf8');
  assert.match(migration, /column_name = 'target_type'/);
  assert.match(migration, /column_name = 'target_id'/);
  assert.match(migration, /EXECUTE/);
  assert.match(migration, /jsonb_object_agg\(field_name, value\)/);
  assert.match(migration, /NULL::text/);
});

test('manual Winline queue migration allows only one active request', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '004_manual_winline_refresh_queue.sql'), 'utf8');
  assert.match(migration, /winline_refresh_requests/);
  assert.match(migration, /status IN \('pending', 'running'\)/);
  assert.match(migration, /UNIQUE INDEX/);
});
