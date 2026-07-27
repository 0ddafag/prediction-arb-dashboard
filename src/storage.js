const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'data', 'store.json');

function readStore() {
  return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
}

function writeStore(store) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2) + '\n', 'utf8');
}

function updateNormalizedMarket(bookmakerMarketId, updater) {
  const store = readStore();
  const index = store.bookmaker_market_normalized.findIndex((item) => item.bookmaker_market_id === bookmakerMarketId);
  if (index === -1) {
    throw new Error(`Unknown bookmaker_market_id: ${bookmakerMarketId}`);
  }
  const updated = updater({ ...store.bookmaker_market_normalized[index] });
  store.bookmaker_market_normalized[index] = updated;
  writeStore(store);
  return updated;
}

function updateMarketPair(pairId, updater) {
  const store = readStore();
  const index = store.market_pairs.findIndex((item) => item.pair_id === pairId);
  if (index === -1) {
    throw new Error(`Unknown pair_id: ${pairId}`);
  }
  const updated = updater({ ...store.market_pairs[index] });
  store.market_pairs[index] = updated;
  writeStore(store);
  return updated;
}

function ensureLiveOverrides(store) {
  store.live_overrides ||= {};
  store.live_overrides.bookmaker_odds ||= {};
  store.live_overrides.pair_prices ||= {};
  return store.live_overrides;
}

function updateLiveBookmakerOverride(bookmakerMarketId, value) {
  const store = readStore();
  const overrides = ensureLiveOverrides(store);
  if (value === '' || value == null) delete overrides.bookmaker_odds[bookmakerMarketId];
  else overrides.bookmaker_odds[bookmakerMarketId] = Number(value);
  writeStore(store);
  return { bookmaker_market_id: bookmakerMarketId, edited_decimal_odds: overrides.bookmaker_odds[bookmakerMarketId] ?? null };
}

function updateLivePairOverride(pairId, values) {
  const store = readStore();
  const overrides = ensureLiveOverrides(store);
  overrides.pair_prices[pairId] = { ...values };
  writeStore(store);
  return { pair_id: pairId, ...overrides.pair_prices[pairId] };
}

function createManualInput(payload) {
  const store = readStore();
  const now = new Date().toISOString();
  const inputId = `input-${Date.now()}`;
  const bookmakerMarketId = `bm-${Date.now()}`;
  const sourceMode = payload.source_mode || 'manual_form';
  const marketType = payload.market_type || 'yes_no';
  const outcomeKey = payload.outcome_key || 'yes';
  const outcomeLabel = payload.outcome_label || payload.outcome_key || 'Manual outcome';
  const odds = Number(payload.captured_decimal_odds || payload.edited_decimal_odds || 0);

  const input = {
    input_id: inputId,
    bookmaker_key: payload.bookmaker_key || 'ligastavok',
    source_mode: sourceMode,
    source_ref: payload.source_ref || 'manual://ui',
    sport_raw: payload.sport || 'manual',
    event_raw: payload.event_title || 'Manual event',
    event_time_raw: payload.event_start_at || '',
    market_type_raw: marketType,
    outcomes_raw_json: [{ outcome_key: outcomeKey, outcome_label: outcomeLabel }],
    odds_raw_json: { [outcomeKey]: odds || null },
    captured_at: now,
    parse_confidence: sourceMode === 'screenshot_manual' ? 0.62 : 1,
    review_status: 'candidate',
    review_notes: payload.review_notes || 'Created from dashboard manual form.'
  };

  const normalized = {
    bookmaker_market_id: bookmakerMarketId,
    input_id: inputId,
    bookmaker_key: input.bookmaker_key,
    event_title: payload.event_title || 'Manual event',
    event_start_at: payload.event_start_at || now,
    sport: payload.sport || 'manual',
    market_type: marketType,
    outcome_key: outcomeKey,
    outcome_label: outcomeLabel,
    captured_decimal_odds: odds || null,
    edited_decimal_odds: payload.edited_decimal_odds ? Number(payload.edited_decimal_odds) : null,
    effective_decimal_odds: payload.edited_decimal_odds ? Number(payload.edited_decimal_odds) : odds || null,
    implied_prob: odds > 1 ? 1 / odds : null,
    limit_notes: payload.limit_notes || 'Manual entry from dashboard',
    source_mode: sourceMode,
    normalized_at: now
  };

  store.bookmaker_inputs.unshift(input);
  store.bookmaker_market_normalized.unshift(normalized);

  if (payload.poly_market_id) {
    store.market_pairs.unshift({
      pair_id: `pair-${Date.now()}`,
      bookmaker_market_id: bookmakerMarketId,
      poly_market_id: String(payload.poly_market_id),
      pairing_mode: 'manual',
      mapping_confidence: 0.55,
      mapping_status: 'candidate',
      settlement_caveat: payload.settlement_caveat || 'Manual mapping candidate created from dashboard form.',
      same_outcome_side: outcomeKey,
      poly_hedge_side: 'NO',
      created_at: now
    });
  }

  writeStore(store);
  return normalized;
}

module.exports = {
  readStore,
  writeStore,
  updateNormalizedMarket,
  updateMarketPair,
  updateLiveBookmakerOverride,
  updateLivePairOverride,
  createManualInput,
  STORE_PATH,
};
