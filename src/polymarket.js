const GAMMA_BASE = 'https://gamma-api.polymarket.com';
const CLOB_BASE = 'https://clob.polymarket.com';
const DEFAULT_IDS = ['540817', '540818'];
const REQUEST_TIMEOUT_MS = Number(process.env.POLYMARKET_TIMEOUT_MS || 10000);

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Hermes-Arb-Dashboard/0.1',
      Accept: 'application/json',
    },
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    throw new Error(`Polymarket request failed (${response.status}) for ${url}`);
  }
  return response.json();
}

function parseMaybeJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function fetchOutcomePriceViews(tokenId, mid = null) {
  if (!tokenId) {
    return { token_id: null, buy: null, sell: null, mid };
  }

  const [buyResult, sellResult] = await Promise.allSettled([
    fetchJson(`${CLOB_BASE}/price?token_id=${tokenId}&side=buy`),
    fetchJson(`${CLOB_BASE}/price?token_id=${tokenId}&side=sell`),
  ]);

  const buy = buyResult.status === 'fulfilled' ? Number(buyResult.value?.price) : null;
  const sell = sellResult.status === 'fulfilled' ? Number(sellResult.value?.price) : null;

  return {
    token_id: tokenId,
    buy: Number.isFinite(buy) ? buy : null,
    sell: Number.isFinite(sell) ? sell : null,
    mid: Number.isFinite(Number(mid)) ? Number(mid) : null,
  };
}

async function enrichMarket(market) {
  const outcomes = parseMaybeJsonArray(market.outcomes);
  const outcomePrices = parseMaybeJsonArray(market.outcomePrices).map((value) => Number(value));
  const clobTokenIds = parseMaybeJsonArray(market.clobTokenIds);
  const tokenPriceViews = await Promise.all(
    clobTokenIds.map((tokenId, index) => fetchOutcomePriceViews(tokenId, outcomePrices[index]))
  );

  return {
    ...market,
    outcomes,
    outcomePrices,
    clobTokenIds,
    token_price_views: tokenPriceViews,
  };
}

async function fetchMarketById(id) {
  const market = await fetchJson(`${GAMMA_BASE}/markets/${id}`);
  return enrichMarket(market);
}

async function fetchFeaturedMarkets(limit = 6) {
  const data = await fetchJson(`${GAMMA_BASE}/markets?active=true&closed=false&limit=${limit}`);
  const markets = Array.isArray(data) ? data : [];
  return Promise.all(markets.map((market) => enrichMarket(market)));
}

async function fetchMappedMarkets(ids = DEFAULT_IDS) {
  const uniqueIds = [...new Set(ids.filter(Boolean).map(String))];
  const markets = await Promise.all(uniqueIds.map((id) => fetchMarketById(id)));
  return markets;
}

module.exports = {
  fetchMappedMarkets,
  fetchFeaturedMarkets,
};
