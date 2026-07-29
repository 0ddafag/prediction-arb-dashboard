const { fetchLiveFonbetPolymarketSource } = require('./live-fonbet-polymarket');
const { fetchLiveWinlinePolymarketSource } = require('./live-winline-polymarket');

function mergeSources(results) {
  const fulfilled = results.filter((result) => result.status === 'fulfilled').map((result) => result.value);
  const rejected = results.filter((result) => result.status === 'rejected');
  const warnings = rejected.map((result) => `${result.source || result.reason?.source || 'unknown'}: ${result.reason?.message || 'Unknown live source error'}`);
  const sourceStatus = {};
  for (const source of fulfilled) sourceStatus[source.metadata?.bookmaker || source.metadata?.source?.split('_')[0] || 'unknown'] = { status: 'ok', metadata: source.metadata || {} };
  for (const result of rejected) sourceStatus[result.source || result.reason?.source || 'unknown'] = { status: 'error', error: result.reason?.message || 'Unknown live source error' };
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
      source_status: sourceStatus,
      matches_by_sport: matchesBySport,
      matches: Object.values(matchesBySport).reduce((sum, count) => sum + count, 0),
    },
  };
}

async function fetchLiveSportsbookPolymarketSource(options = {}) {
  const results = await Promise.all([
    Promise.resolve(fetchLiveFonbetPolymarketSource(options)).then((value) => ({ status: 'fulfilled', value, source: 'fonbet' }), (reason) => ({ status: 'rejected', reason, source: 'fonbet' })),
    Promise.resolve(fetchLiveWinlinePolymarketSource(options)).then((value) => ({ status: 'fulfilled', value, source: 'winline' }), (reason) => ({ status: 'rejected', reason, source: 'winline' })),
  ]);
  return mergeSources(results);
}

module.exports = { fetchLiveSportsbookPolymarketSource, mergeSources };
