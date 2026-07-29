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
      for (const file of ['001_core.sql', '002_dashboard_state.sql']) {
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
      database.query('SELECT target_type, target_id, field_name, value FROM manual_overrides'),
      database.query('SELECT * FROM opportunities ORDER BY updated_at DESC'),
    ]);
    const state = emptyPersistentState();
    for (const row of settings.rows) state.settings[row.key] = row.value;
    for (const row of overrides.rows) {
      state.manual_overrides[row.target_id] ||= { row_id: row.target_id, target_type: row.target_type, override: {} };
      state.manual_overrides[row.target_id].override[row.field_name] = row.value;
      if (row.target_type === 'bookmaker_market' && row.field_name === 'edited_decimal_odds') {
        state.live_overrides.bookmaker_odds[row.target_id] = row.value;
      }
      if (row.target_type === 'market_pair') {
        state.live_overrides.pair_prices[row.target_id] ||= {};
        state.live_overrides.pair_prices[row.target_id][row.field_name] = row.value;
      }
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

async function upsertOverride({ rowId, targetType = 'dashboard_row', override = {} }, env = process.env) {
  if (!rowId) throw new Error('row_id is required');
  const database = getPool(env);
  if (!database) return { row_id: rowId, target_type: targetType, override, persisted: false };
  await initializePostgres(env);
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM manual_overrides WHERE target_type = $1 AND target_id = $2', [targetType, rowId]);
    for (const [fieldName, value] of Object.entries(override || {})) {
      if (value !== undefined && value !== null && value !== '') {
        await client.query(
          `INSERT INTO manual_overrides (target_type, target_id, field_name, value)
           VALUES ($1, $2, $3, $4::jsonb)
           ON CONFLICT (target_type, target_id, field_name)
           DO UPDATE SET value = EXCLUDED.value, created_at = now()`,
          [targetType, rowId, fieldName, JSON.stringify(value)]
        );
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return { row_id: rowId, target_type: targetType, override, persisted: true };
}

async function saveSourceSnapshot(source, summary, raw, env = process.env) {
  const database = getPool(env);
  if (!database) return { persisted: false };
  await initializePostgres(env);
  await database.query(
    'INSERT INTO source_snapshots (source, captured_at, summary, raw) VALUES ($1, now(), $2::jsonb, $3::jsonb)',
    [source, JSON.stringify(summary || {}), JSON.stringify(raw || {})]
  );
  return { persisted: true };
}

async function getLatestSourceSnapshot(source, env = process.env) {
  const database = getPool(env);
  if (!database) return null;
  try {
    await initializePostgres(env);
    const result = await database.query(
      'SELECT captured_at, summary, raw FROM source_snapshots WHERE source = $1 ORDER BY captured_at DESC LIMIT 1',
      [source]
    );
    return result.rows[0] || null;
  } catch {
    return null;
  }
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
};
