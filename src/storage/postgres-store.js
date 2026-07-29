function isPostgresConfigured(env = process.env) {
  return Boolean(String(env.DATABASE_URL || '').trim());
}

const fs = require('node:fs');
const path = require('node:path');

let pool;
let initialization;

function getPool(env = process.env) {
  if (!isPostgresConfigured(env)) return null;
  if (!pool) {
    const { Pool } = require('pg');
    pool = new Pool({ connectionString: env.DATABASE_URL, max: 4, idleTimeoutMillis: 30000 });
  }
  return pool;
}

async function initializePostgres(env = process.env) {
  const database = getPool(env);
  if (!database) return false;
  if (!initialization) {
    initialization = (async () => {
      for (const file of ['001_core.sql', '002_dashboard_state.sql', '003_neon_winline_pipeline.sql', '004_manual_winline_refresh_queue.sql']) {
        await database.query(fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', file), 'utf8'));
      }
      return true;
    })().catch((error) => {
      initialization = null;
      throw error;
    });
  }
  return initialization;
}

function emptyPersistentState() {
  return { settings: {}, manual_overrides: {}, live_overrides: { bookmaker_odds: {}, pair_prices: {} }, opportunities: [], warning: null };
}

async function getPersistentState(env = process.env) {
  const database = getPool(env);
  if (!database) return emptyPersistentState();
  try {
    await initializePostgres(env);
    const [settings, overrides, opportunities] = await Promise.all([
      database.query('SELECT key, value FROM dashboard_settings'),
      database.query('SELECT row_id, bookmaker_key, provider_event_id, market_key, poly_market_id, poly_outcome, override FROM manual_overrides'),
      database.query('SELECT * FROM opportunities ORDER BY updated_at DESC'),
    ]);
    const state = emptyPersistentState();
    for (const row of settings.rows) state.settings[row.key] = row.value;
    for (const row of overrides.rows) {
      state.manual_overrides[row.row_id] = row;
      if (row.override?.edited_decimal_odds != null) state.live_overrides.bookmaker_odds[row.row_id] = row.override.edited_decimal_odds;
      const pairPrice = Object.fromEntries(Object.entries(row.override || {}).filter(([key]) => key.startsWith('poly_no_')));
      if (Object.keys(pairPrice).length) state.live_overrides.pair_prices[row.row_id] = pairPrice;
    }
    state.opportunities = opportunities.rows;
    return state;
  } catch (error) {
    return { ...emptyPersistentState(), warning: `Postgres unavailable: ${error.message}` };
  }
}

async function upsertSetting(key, value, env = process.env) {
  const database = getPool(env);
  if (!database) return { key, value, persisted: false };
  await initializePostgres(env);
  await database.query(
    `INSERT INTO dashboard_settings (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)]
  );
  return { key, value, persisted: true };
}

async function upsertOverride({ rowId, targetType = 'dashboard_row', override = {}, bookmakerKey = null, providerEventId = null, marketKey = null, polyMarketId = null, polyOutcome = null }, env = process.env) {
  if (!rowId) throw new Error('row_id is required');
  const database = getPool(env);
  if (!database) return { row_id: rowId, target_type: targetType, override, persisted: false };
  await initializePostgres(env);
  await database.query(
    `INSERT INTO manual_overrides (row_id, bookmaker_key, provider_event_id, market_key, poly_market_id, poly_outcome, override)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT (row_id) DO UPDATE SET bookmaker_key = EXCLUDED.bookmaker_key,
       provider_event_id = EXCLUDED.provider_event_id, market_key = EXCLUDED.market_key,
       poly_market_id = EXCLUDED.poly_market_id, poly_outcome = EXCLUDED.poly_outcome,
       override = EXCLUDED.override, updated_at = now()`,
    [rowId, bookmakerKey, providerEventId, marketKey || targetType, polyMarketId, polyOutcome, JSON.stringify(override || {})]
  );
  return { row_id: rowId, target_type: targetType, override, persisted: true };
}

async function saveSourceSnapshot(source, summary, raw, env = process.env, details = {}) {
  const database = getPool(env);
  if (!database) return { persisted: false };
  await initializePostgres(env);
  await database.query(
    `INSERT INTO live_source_snapshots (source, captured_at, status, error, summary, raw)
     VALUES ($1, COALESCE($2::timestamptz, now()), $3, $4, $5::jsonb, $6::jsonb)
     ON CONFLICT (source) DO UPDATE SET captured_at = EXCLUDED.captured_at, status = EXCLUDED.status,
       error = EXCLUDED.error, summary = EXCLUDED.summary, raw = EXCLUDED.raw, updated_at = now()`,
    [source, details.capturedAt || null, details.status || 'ok', details.error || null, JSON.stringify(summary || {}), JSON.stringify(raw || {})]
  );
  return { persisted: true };
}

async function getLatestSourceSnapshot(source, env = process.env) {
  const database = getPool(env);
  if (!database) return null;
  try {
    await initializePostgres(env);
    const result = await database.query('SELECT captured_at, status, error, summary, raw, updated_at FROM live_source_snapshots WHERE source = $1', [source]);
    return result.rows[0] || null;
  } catch {
    return null;
  }
}

async function enqueueWinlineRefresh(env = process.env, requestSource = 'dashboard') {
  const database = getPool(env);
  if (!database) return null;
  await initializePostgres(env);
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO winline_refresh_requests (request_source)
       VALUES ($1)
       ON CONFLICT DO NOTHING
       RETURNING id, requested_at, status, started_at, finished_at`,
      [requestSource]
    );
    const result = inserted.rows[0]
      ? inserted
      : await client.query(
        `SELECT id, requested_at, status, started_at, finished_at
         FROM winline_refresh_requests
         WHERE status IN ('pending', 'running')
         ORDER BY requested_at ASC
         LIMIT 1`
      );
    await client.query('COMMIT');
    return result.rows[0] || null;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function getLatestWinlineRefreshRequest(env = process.env) {
  const database = getPool(env);
  if (!database) return null;
  await initializePostgres(env);
  const result = await database.query(
    `SELECT id, requested_at, status, started_at, finished_at, worker_id, error, result, request_source
     FROM winline_refresh_requests ORDER BY requested_at DESC LIMIT 1`
  );
  return result.rows[0] || null;
}

async function getWinlineRefreshRequest(id, env = process.env) {
  const database = getPool(env);
  if (!database) return null;
  await initializePostgres(env);
  const result = await database.query(
    `SELECT id, requested_at, status, started_at, finished_at, worker_id, error, result, request_source
     FROM winline_refresh_requests WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

async function claimPendingWinlineRefresh(workerId, env = process.env) {
  const database = getPool(env);
  if (!database) return null;
  await initializePostgres(env);
  const result = await database.query(
    `WITH next_request AS (
       SELECT id FROM winline_refresh_requests
       WHERE status = 'pending' ORDER BY requested_at ASC
       FOR UPDATE SKIP LOCKED LIMIT 1
     )
     UPDATE winline_refresh_requests AS request
     SET status = 'running', started_at = now(), worker_id = $1
     FROM next_request WHERE request.id = next_request.id
     RETURNING request.id, request.requested_at, request.status, request.started_at, request.worker_id, request.request_source`,
    [workerId]
  );
  return result.rows[0] || null;
}

async function completeWinlineRefresh(id, status, { result = null, error = null } = {}, env = process.env) {
  if (!['succeeded', 'failed'].includes(status)) throw new Error(`Invalid Winline refresh completion status: ${status}`);
  const database = getPool(env);
  if (!database) return null;
  await initializePostgres(env);
  const queryResult = await database.query(
    `UPDATE winline_refresh_requests
     SET status = $2, finished_at = now(), result = $3::jsonb, error = $4
     WHERE id = $1
     RETURNING id, requested_at, status, started_at, finished_at, worker_id, error, result, request_source`,
    [id, status, result == null ? null : JSON.stringify(result), error]
  );
  return queryResult.rows[0] || null;
}

function buildStoreSnapshotRows(store) {
  const inputs = new Map((store.bookmaker_inputs || []).map((item) => [item.input_id, item]));
  const canonicalEventsMap = new Map();

  const bookmakerMarkets = (store.bookmaker_market_normalized || []).map((market) => {
    const input = inputs.get(market.input_id) || {};
    const eventKey = [market.sport, market.event_title, market.event_start_at].join('|');
    if (!canonicalEventsMap.has(eventKey)) {
      canonicalEventsMap.set(eventKey, {
        event_key: eventKey,
        sport: market.sport,
        title: market.event_title,
        start_at: market.event_start_at,
        status: 'upcoming',
      });
    }
    return {
      ...market,
      event_key: eventKey,
      source_ref: input.source_ref || null,
      raw_payload: input,
    };
  });

  const predictionMarkets = [...new Map((store.market_pairs || []).map((pair) => [String(pair.poly_market_id), {
    venue: 'polymarket',
    external_market_id: String(pair.poly_market_id),
  }])).values()];

  const marketMappings = (store.market_pairs || []).map((pair) => ({
    ...pair,
    bookmaker_key: pair.bookmaker_key || 'winline',
    prediction_venue: 'polymarket',
    sport: pair.sport || 'baseball',
    market_family: pair.market_family || 'moneyline_2way',
    settlement_scope: pair.settlement_scope || 'full_game',
    hedge_strategy: pair.hedge_strategy || 'opposite_yes',
    basis_risk: pair.basis_risk || 'NONE',
  }));

  const quotes = bookmakerMarkets.map((market) => ({
    venue: market.bookmaker_key,
    market_ref: market.bookmaker_market_id,
    quote_type: 'decimal_odds',
    price: market.effective_decimal_odds,
    captured_at: market.normalized_at,
    raw_payload: null,
  }));

  return {
    canonicalEvents: [...canonicalEventsMap.values()],
    bookmakerMarkets,
    predictionMarkets,
    marketMappings,
    quotes,
  };
}

module.exports = {
  isPostgresConfigured,
  buildStoreSnapshotRows,
  getPersistentState,
  initializePostgres,
  upsertSetting,
  upsertOverride,
  saveSourceSnapshot,
  getLatestSourceSnapshot,
  enqueueWinlineRefresh,
  getLatestWinlineRefreshRequest,
  getWinlineRefreshRequest,
  claimPendingWinlineRefresh,
  completeWinlineRefresh,
};
