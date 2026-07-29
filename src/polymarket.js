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

function normalizeClobBook(book = {}) {
  const bids = (book.bids || [])
    .map((level) => ({ price: Number(level.price), size: Number(level.size) }))
    .filter((level) => Number.isFinite(level.price) && Number.isFinite(level.size));
  const asks = (book.asks || [])
    .map((level) => ({ price: Number(level.price), size: Number(level.size) }))
    .filter((level) => Number.isFinite(level.price) && Number.isFinite(level.size));
  const bestBid = bids.sort((a, b) => b.price - a.price)[0] || null;
  const bestAsk = asks.sort((a, b) => a.price - b.price)[0] || null;
  return {
    best_bid: bestBid?.price ?? null,
    best_bid_size: bestBid?.size ?? null,
    best_ask: bestAsk?.price ?? null,
    best_ask_size: bestAsk?.size ?? null,
  };
}

async function fetchOutcomePriceViews(tokenId, mid = null) {
  if (!tokenId) {
    return { token_id: null, buy: null, sell: null, mid, best_bid_size: null, best_ask_size: null };
  }

  let book;
  try {
    book = normalizeClobBook(await fetchJson(`${CLOB_BASE}/book?token_id=${tokenId}`));
  } catch {
    book = { best_bid: null, best_bid_size: null, best_ask: null, best_ask_size: null };
  }

  return {
    token_id: tokenId,
    buy: book.best_bid,
    sell: book.best_ask,
    mid: Number.isFinite(Number(mid)) ? Number(mid) : null,
    best_bid_size: book.best_bid_size,
    best_ask_size: book.best_ask_size,
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

async function fetchSportsEvents(
  tag,
  { limit = 100, ascending = true, pages = 1, fetchJsonImpl = fetchJson } = {}
) {
  const results = [];
  for (let page = 0; page < Math.max(1, pages); page += 1) {
    const url = new URL('/events', GAMMA_BASE);
    url.searchParams.set('active', 'true');
    url.searchParams.set('closed', 'false');
    url.searchParams.set('tag_slug', tag);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(page * limit));
    url.searchParams.set('order', 'startDate');
    url.searchParams.set('ascending', String(ascending));
    const data = await fetchJsonImpl(url.toString());
    if (!Array.isArray(data) || !data.length) break;
    results.push(...data);
    if (data.length < limit) break;
  }
  return [...new Map(results.map((event) => [String(event.id || `${event.slug}-${event.startDate}`), event])).values()];
}

async function fetchMappedMarkets(ids = DEFAULT_IDS) {
  const uniqueIds = [...new Set(ids.filter(Boolean).map(String))];
  const markets = await Promise.all(uniqueIds.map((id) => fetchMarketById(id)));
  return markets;
}

module.exports = {
  fetchMappedMarkets,
  fetchFeaturedMarkets,
  fetchSportsEvents,
  enrichMarket,
  normalizeClobBook,
};
