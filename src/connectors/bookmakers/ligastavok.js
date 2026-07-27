const { createBookmakerConnector } = require('./base');

const SPORTS_SITEMAP_URL = 'https://www.ligastavok.ru/sitemap-sports.xml';

function extractPublicSitemapEvents(xml, sports = ['baseball', 'combats']) {
  const allowedSports = new Set(sports);
  const results = [];
  const locations = String(xml).matchAll(/<loc>([^<]+)<\/loc>/g);

  for (const match of locations) {
    const sourceUrl = match[1].replaceAll('&amp;', '&');
    let parsed;
    try {
      parsed = new URL(sourceUrl);
    } catch {
      continue;
    }
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'sports' || !allowedSports.has(parts[1]) || !parts[2]) continue;
    const identity = parts[2].match(/^(.*)-id-(\d+)-service-id-(\d+)-ext-id-(\d+)$/);
    if (!identity) continue;
    results.push({
      sport: parts[1],
      slug: identity[1],
      provider_event_id: Number(identity[2]),
      service_id: Number(identity[3]),
      external_event_id: Number(identity[4]),
      source_url: sourceUrl,
      decimal_odds: null,
    });
  }

  return results;
}

async function fetchPublicSitemapEvents({ fetchImpl = fetch, sports } = {}) {
  const response = await fetchImpl(SPORTS_SITEMAP_URL, {
    headers: { accept: 'application/xml,text/xml;q=0.9' },
  });
  if (!response.ok) throw new Error(`Liga Stavok sitemap HTTP ${response.status}`);
  return extractPublicSitemapEvents(await response.text(), sports);
}

const baseConnector = createBookmakerConnector({
  key: 'ligastavok',
  label: 'Liga Stavok',
  status: 'research',
  notes: 'Public sitemaps expose event IDs, but event/line pages are blocked by Qrator and no odds transport has been confirmed.',
});

module.exports = Object.freeze({
  ...baseConnector,
  transport: Object.freeze({
    type: 'unconfirmed',
    website_url: 'https://www.ligastavok.ru/',
    access_from_current_host: 'event_pages_qrator_401_browser_qrerror_403',
    public_event_index: SPORTS_SITEMAP_URL,
    public_odds_endpoint: null,
    websocket_url: null,
    bypass_attempted: false,
  }),
  extractPublicSitemapEvents,
  fetchPublicSitemapEvents,
});
