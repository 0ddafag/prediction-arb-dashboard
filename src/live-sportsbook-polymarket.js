const { fetchLiveFonbetPolymarketSource } = require('./live-fonbet-polymarket');
const { fetchLiveWinlinePolymarketSource } = require('./live-winline-polymarket');

function mergeSources(results) {
  const fulfilled = results.filter((result) => result.status === 'fulfilled').map((result) => result.value);
  const warnings = results.filter((result) => result.status === 'rejected').map((result) => result.reason?.message || 'Unknown live source error');
  const mappedById = new Map();
  for (const source of fulfilled) {
    for (const market of source.mapped_markets || []) mappedById.set(String(market.id), market);
  }
  const matchesBySport = {};
  for (const source of fulfilled) {
    for (const [sport, count] of Object.entries(source.metadata?.matches_by_sport || {})) {
      matchesBySport[sport] = (matchesBySport[sport] || 0) + count;
    }
  }
  const captured = fulfilled.map((source) => source.metadata?.captured_at).filter(Boolean).sort();
  return {
    bookmaker_inputs: fulfilled.flatMap((source) => source.bookmaker_inputs || []),
    bookmaker_market_normalized: fulfilled.flatMap((source) => source.bookmaker_market_normalized || []),
    market_pairs: fulfilled.flatMap((source) => source.market_pairs || []),
    mapped_markets: [...mappedById.values()],
    metadata: {
      source: 'multi_live_sportsbook',
      captured_at: captured[captured.length - 1] || new Date().toISOString(),
      sources: fulfilled.map((source) => source.metadata || {}),
      warnings,
      matches_by_sport: matchesBySport,
      matches: Object.values(matchesBySport).reduce((sum, count) => sum + count, 0),
    },
  };
}

async function fetchLiveSportsbookPolymarketSource(options = {}) {
  const results = await Promise.allSettled([
    fetchLiveFonbetPolymarketSource(options),
    fetchLiveWinlinePolymarketSource(options),
  ]);
  return mergeSources(results);
}

module.exports = { fetchLiveSportsbookPolymarketSource, mergeSources };
