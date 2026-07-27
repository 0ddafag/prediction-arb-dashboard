const REST_BASE_URL = 'https://api.predict.fun';
const GRAPHQL_URL = 'https://graphql.predict.fun/graphql';
const WS_URL = 'wss://ws.predict.fun/ws';

function complement(price, precision = 2) {
  const factor = 10 ** precision;
  return (factor - Math.round(Number(price) * factor)) / factor;
}

function numberLevels(levels = []) {
  return levels
    .map(([price, quantity]) => [Number(price), Number(quantity)])
    .filter(([price, quantity]) => Number.isFinite(price) && Number.isFinite(quantity));
}

function normalizePredictOrderbook(payload, precision = 2) {
  const data = payload?.data || payload || {};
  const yesAsks = numberLevels(data.asks).sort((a, b) => a[0] - b[0]);
  const yesBids = numberLevels(data.bids).sort((a, b) => b[0] - a[0]);
  const noBids = yesAsks.map(([price, quantity]) => [complement(price, precision), quantity])
    .sort((a, b) => b[0] - a[0]);
  const noAsks = yesBids.map(([price, quantity]) => [complement(price, precision), quantity])
    .sort((a, b) => a[0] - b[0]);

  return {
    market_id: data.marketId ?? null,
    updated_at_ms: data.updateTimestampMs ?? null,
    source_semantics: 'yes_bids_and_asks',
    yes: { bids: yesBids, asks: yesAsks, best_bid: yesBids[0]?.[0] ?? null, best_ask: yesAsks[0]?.[0] ?? null },
    no: { bids: noBids, asks: noAsks, best_bid: noBids[0]?.[0] ?? null, best_ask: noAsks[0]?.[0] ?? null },
  };
}

function estimatePredictFee({ shares, price, takerFeeBps = 200, discountFactor = 1 }) {
  const fee = (Number(takerFeeBps) / 10_000)
    * Math.min(Number(price), 1 - Number(price))
    * Number(shares)
    * Number(discountFactor);
  return Number(fee.toFixed(10));
}

function buildPublicCategoriesQuery(first = 100, after = null) {
  const pageSize = Math.max(1, Math.min(100, Number(first) || 100));
  const afterPart = after ? `, after: ${JSON.stringify(String(after))}` : '';
  return `query {
    categories(filter: {status: OPEN}, sort: MOST_POPULAR, pagination: {first: ${pageSize}${afterPart}}) {
      totalCount
      pageInfo { hasNextPage endCursor }
      edges { node {
        id slug title status marketVariant resolutionProvider isNegRisk isYieldBearing
        decimalPrecision startsAt endsAt
        statistics { liquidityValueUsd volumeTotalUsd volume24hUsd }
        markets { edges { node {
          id title question makerFeeBps takerFeeBps status decimalPrecision
          isTradingEnabled conditionId chancePercentage
        } } }
      } }
    }
  }`;
}

async function fetchPredictPublicCategories({ first = 100, after = null, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: buildPublicCategoriesQuery(first, after) }),
  });
  if (!response.ok) throw new Error(`Predict public discovery failed: ${response.status}`);
  const payload = await response.json();
  if (payload.errors?.length) throw new Error(`Predict public discovery GraphQL error: ${payload.errors[0].message}`);
  return payload.data.categories;
}

async function fetchPredictMarkets({ first = 100, status, apiKey, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error('Predict API key is required');
  const url = new URL(`${REST_BASE_URL}/v1/markets`);
  url.searchParams.set('first', String(first));
  if (status) url.searchParams.set('status', status);
  const response = await fetchImpl(url, { headers: { 'x-api-key': apiKey } });
  if (!response.ok) throw new Error(`Predict markets request failed: ${response.status}`);
  return response.json();
}

async function fetchPredictOrderbook(marketId, { apiKey, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error('Predict API key is required');
  const response = await fetchImpl(`${REST_BASE_URL}/v1/markets/${encodeURIComponent(marketId)}/orderbook`, {
    headers: { 'x-api-key': apiKey },
  });
  if (!response.ok) throw new Error(`Predict orderbook request failed: ${response.status}`);
  return response.json();
}

const predictFunConnector = Object.freeze({
  key: 'predictfun',
  label: 'Predict.fun',
  status: 'read_only_research',
  rest_base_url: REST_BASE_URL,
  graphql_url: GRAPHQL_URL,
  websocket_url: WS_URL,
  discovery: { endpoint: GRAPHQL_URL, authentication: 'public_undocumented_graphql' },
  documented_discovery: { endpoint: '/v1/markets', authentication: 'api_key' },
  orderbook: { endpoint: '/v1/markets/{id}/orderbook', authentication: 'api_key', source_semantics: 'yes_bids_and_asks' },
  websocket: { authentication: 'api_key', orderbook_topic: 'predictOrderbook/{marketId}' },
  fee_model: { maker_bps: 0, taker_bps_from_market: true, default_taker_bps: 200 },
});

module.exports = {
  REST_BASE_URL,
  GRAPHQL_URL,
  WS_URL,
  predictFunConnector,
  normalizePredictOrderbook,
  estimatePredictFee,
  buildPublicCategoriesQuery,
  fetchPredictPublicCategories,
  fetchPredictMarkets,
  fetchPredictOrderbook,
};
