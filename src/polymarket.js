const GAMMA_BASE = 'https://gamma-api.polymarket.com';
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

async function fetchMarketById(id) {
  return fetchJson(`${GAMMA_BASE}/markets/${id}`);
}

async function fetchFeaturedMarkets(limit = 6) {
  const data = await fetchJson(`${GAMMA_BASE}/markets?active=true&closed=false&limit=${limit}`);
  return Array.isArray(data) ? data : [];
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
