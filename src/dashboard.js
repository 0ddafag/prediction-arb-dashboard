const { readStore } = require('./storage');
const { buildArbSnapshot, impliedProbability } = require('./math');
const { fetchMappedMarkets, fetchFeaturedMarkets } = require('./polymarket');
const { buildBookmakerAdapters, getBookmakerLabel, listBookmakers } = require('./bookmaker');
const { SPORT_TABS } = require('./domain');
const { sortTopOpportunities } = require('./opportunities');
const { fetchLiveSportsbookPolymarketSource } = require('./live-sportsbook-polymarket');

function buildInputIndex(items, key) {
  return new Map(items.map((item) => [item[key], item]));
}

function matchIdentity(row) {
  const providerEventId = row.pair?.provider_event_id;
  if (providerEventId != null) return `${row.bookmaker_market?.bookmaker_key || 'book'}:${providerEventId}`;
  return `${row.bookmaker_market?.event_title || 'event'}:${row.bookmaker_market?.event_start_at || ''}`;
}

function countDistinctMatches(rows) {
  return new Set(rows.map(matchIdentity)).size;
}

function buildManualSandboxRows(normalizedMarkets, pairMap) {
  return normalizedMarkets
    .filter((item) => !pairMap.has(item.bookmaker_market_id))
    .map((item) => ({
      bookmaker_market_id: item.bookmaker_market_id,
      event_title: item.event_title,
      market_type: item.market_type,
      outcome_key: item.outcome_key,
      outcome_label: item.outcome_label,
      captured_decimal_odds: item.captured_decimal_odds,
      edited_decimal_odds: item.edited_decimal_odds,
      effective_decimal_odds: item.effective_decimal_odds,
      implied_prob: impliedProbability(item.effective_decimal_odds),
      source_mode: item.source_mode,
      mapping_status: 'unmapped',
    }));
}

async function buildDashboardPayload({
  dataMode = process.env.LIVE_DATA_MODE || 'live',
  liveFetcher = fetchLiveSportsbookPolymarketSource,
  featuredFetcher = fetchFeaturedMarkets,
} = {}) {
  const persistedStore = readStore();
  const mappedIds = persistedStore.market_pairs.map((pair) => pair.poly_market_id);
  const sourcePromise = dataMode === 'seed'
    ? fetchMappedMarkets(mappedIds).then((mappedMarkets) => ({
      ...persistedStore,
      mapped_markets: mappedMarkets,
      metadata: {
        source: 'seed_store',
        captured_at: null,
        matches: persistedStore.market_pairs.length / 2,
      },
    }))
    : liveFetcher({ overrides: persistedStore.live_overrides || {} });

  const [sourceResult, featuredMarketsResult] = await Promise.allSettled([
    sourcePromise,
    featuredFetcher(6),
  ]);
  const sourceOk = sourceResult.status === 'fulfilled';
  const source = sourceOk ? sourceResult.value : {
    bookmaker_inputs: [],
    bookmaker_market_normalized: [],
    market_pairs: [],
    mapped_markets: [],
    metadata: {},
  };
  const store = source;
  const pairMap = buildInputIndex(store.market_pairs, 'bookmaker_market_id');
  const normalizedMap = buildInputIndex(store.bookmaker_market_normalized, 'bookmaker_market_id');
  const inputMap = buildInputIndex(store.bookmaker_inputs, 'input_id');
  const mappedMarkets = source.mapped_markets || [];
  const featuredMarkets = featuredMarketsResult.status === 'fulfilled' ? featuredMarketsResult.value : [];
  const diagnostics = {
    source_mode: dataMode,
    mapped_markets_ok: sourceOk,
    live_data_ok: dataMode === 'live' ? sourceOk : null,
    featured_markets_ok: featuredMarketsResult.status === 'fulfilled',
    source_metadata: source.metadata || {},
    warnings: [sourceResult, featuredMarketsResult]
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason?.message || 'Unknown upstream error'),
  };

  const polyMarketMap = new Map(mappedMarkets.map((market) => [String(market.id), market]));

  const arbSnapshots = store.market_pairs.map((pair) => {
    const bookmakerMarket = normalizedMap.get(pair.bookmaker_market_id);
    const polyMarket = polyMarketMap.get(String(pair.poly_market_id));
    const rawInput = inputMap.get(bookmakerMarket.input_id);
    const snapshot = buildArbSnapshot(pair, bookmakerMarket, polyMarket);
    return {
      ...snapshot,
      pair,
      bookmaker_market: bookmakerMarket,
      bookmaker_input: rawInput,
      bookmaker_label: getBookmakerLabel(bookmakerMarket.bookmaker_key),
      sport: pair.sport || bookmakerMarket.sport || 'baseball',
      polymarket_market: polyMarket,
    };
  }).sort((a, b) => (b.net_edge_limit ?? -999) - (a.net_edge_limit ?? -999));

  const inputs = store.bookmaker_inputs.map((input) => {
    const normalized = store.bookmaker_market_normalized.filter((item) => item.input_id === input.input_id);
    const status = normalized.some((item) => pairMap.has(item.bookmaker_market_id)) ? 'mapped' : input.review_status;
    return {
      ...input,
      normalized_rows: normalized,
      mapping_status: status,
    };
  });

  const matchesBySport = source.metadata?.matches_by_sport || Object.fromEntries(
    [...new Set(arbSnapshots.map((row) => row.sport))]
      .map((sport) => [sport, countDistinctMatches(arbSnapshots.filter((row) => row.sport === sport))])
  );
  const summary = {
    source_mode: dataMode,
    source_captured_at: source.metadata?.captured_at || null,
    matches_by_sport: matchesBySport,
    mapped_pairs: store.market_pairs.length,
    ingestion_items: store.bookmaker_inputs.length,
    editable_markets: store.bookmaker_market_normalized.length,
    best_net_edge_limit: arbSnapshots[0]?.net_edge_limit ?? null,
    updated_at: new Date().toISOString(),
  };

  return {
    generatedAt: new Date().toISOString(),
    source_mode_adapters: buildBookmakerAdapters(),
    filters: {
      sports: SPORT_TABS.map((item) => ({ ...item })),
      bookmakers: listBookmakers(),
    },
    summary,
    diagnostics,
    featured_polymarket_markets: featuredMarkets,
    bookmaker_inputs: inputs,
    bookmaker_market_normalized: store.bookmaker_market_normalized,
    market_pairs: store.market_pairs,
    arb_snapshots: arbSnapshots,
    manual_sandbox_rows: buildManualSandboxRows(store.bookmaker_market_normalized, pairMap),
  };
}

async function buildOpportunitiesPayload({ sport = null, bookmaker = null, view = null } = {}) {
  const payload = await buildDashboardPayload();
  let rows = payload.arb_snapshots;

  if (sport) rows = rows.filter((row) => row.sport === sport);
  if (bookmaker) rows = rows.filter((row) => row.bookmaker_market.bookmaker_key === bookmaker);
  if (view === 'top') rows = sortTopOpportunities(rows);

  return {
    generatedAt: payload.generatedAt,
    filters: payload.filters,
    diagnostics: payload.diagnostics,
    summary: {
      rows: rows.length,
      matches: countDistinctMatches(rows),
      updated_at: payload.summary.updated_at,
    },
    rows,
  };
}

module.exports = { buildDashboardPayload, buildOpportunitiesPayload, countDistinctMatches };
