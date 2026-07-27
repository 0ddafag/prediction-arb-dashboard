const REST_BASE_URL = 'https://external-api.kalshi.com/trade-api/v2';
const WS_URL = 'wss://external-api-ws.kalshi.com/trade-api/ws/v2';

function numberLevels(levels = []) {
  return levels
    .map(([price, quantity]) => [Number(price), Number(quantity)])
    .filter(([price, quantity]) => Number.isFinite(price) && Number.isFinite(quantity));
}

function complement(price, precision = 4) {
  const factor = 10 ** precision;
  return (factor - Math.round(Number(price) * factor)) / factor;
}

function normalizeKalshiOrderbook(payload, precision = 4) {
  const book = payload?.orderbook_fp || payload?.orderbook || payload || {};
  const yesBids = numberLevels(book.yes_dollars || book.yes_dollars_fp || book.yes || [])
    .sort((a, b) => b[0] - a[0]);
  const noBids = numberLevels(book.no_dollars || book.no_dollars_fp || book.no || [])
    .sort((a, b) => b[0] - a[0]);
  const yesAsks = noBids.map(([price, quantity]) => [complement(price, precision), quantity])
    .sort((a, b) => a[0] - b[0]);
  const noAsks = yesBids.map(([price, quantity]) => [complement(price, precision), quantity])
    .sort((a, b) => a[0] - b[0]);

  return {
    source_semantics: 'yes_and_no_bids',
    yes: { bids: yesBids, asks: yesAsks, best_bid: yesBids[0]?.[0] ?? null, best_ask: yesAsks[0]?.[0] ?? null },
    no: { bids: noBids, asks: noAsks, best_bid: noBids[0]?.[0] ?? null, best_ask: noAsks[0]?.[0] ?? null },
  };
}

function ceilToIncrement(value, increment) {
  return Math.ceil((value - Number.EPSILON) / increment) * increment;
}

function estimateKalshiFee({
  contracts,
  price,
  coefficient = 0.07,
  multiplier = 1,
  roundingIncrement = 0.01,
}) {
  const raw = Number(coefficient) * Number(multiplier) * Number(contracts) * Number(price) * (1 - Number(price));
  return Number(ceilToIncrement(raw, Number(roundingIncrement)).toFixed(10));
}

async function fetchKalshiMarkets({ status = 'open', limit = 100, cursor, seriesTicker, fetchImpl = fetch } = {}) {
  const url = new URL(`${REST_BASE_URL}/markets`);
  if (status) url.searchParams.set('status', status);
  url.searchParams.set('limit', String(limit));
  if (cursor) url.searchParams.set('cursor', cursor);
  if (seriesTicker) url.searchParams.set('series_ticker', seriesTicker);
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Kalshi markets request failed: ${response.status}`);
  return response.json();
}

async function fetchKalshiOrderbook(ticker, { depth = 0, authHeaders = {}, fetchImpl = fetch } = {}) {
  const url = new URL(`${REST_BASE_URL}/markets/${encodeURIComponent(ticker)}/orderbook`);
  url.searchParams.set('depth', String(depth));
  const response = await fetchImpl(url, { headers: authHeaders });
  if (!response.ok) throw new Error(`Kalshi orderbook request failed: ${response.status}`);
  return response.json();
}

const kalshiConnector = Object.freeze({
  key: 'kalshi',
  label: 'Kalshi',
  status: 'read_only_research',
  rest_base_url: REST_BASE_URL,
  websocket_url: WS_URL,
  discovery: { endpoint: '/markets', authentication: 'public' },
  orderbook: { endpoint: '/markets/{ticker}/orderbook', authentication: 'rsa_api_key', source_semantics: 'yes_and_no_bids' },
  websocket: { authentication: 'rsa_api_key', channels: ['orderbook_delta', 'ticker', 'trade'] },
  fee_model: { default_type: 'quadratic', default_coefficient: 0.07, supports_series_overrides: true },
});

module.exports = {
  REST_BASE_URL,
  WS_URL,
  kalshiConnector,
  normalizeKalshiOrderbook,
  estimateKalshiFee,
  fetchKalshiMarkets,
  fetchKalshiOrderbook,
};
