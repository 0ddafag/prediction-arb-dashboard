const { readStore } = require('./storage');
const { buildArbSnapshot, impliedProbability } = require('./math');
const { fetchMappedMarkets, fetchFeaturedMarkets } = require('./polymarket');
const { buildBookmakerAdapters } = require('./bookmaker');

function buildInputIndex(items, key) {
  return new Map(items.map((item) => [item[key], item]));
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

async function buildDashboardPayload() {
  const store = readStore();
  const pairMap = buildInputIndex(store.market_pairs, 'bookmaker_market_id');
  const normalizedMap = buildInputIndex(store.bookmaker_market_normalized, 'bookmaker_market_id');
  const inputMap = buildInputIndex(store.bookmaker_inputs, 'input_id');
  const mappedIds = store.market_pairs.map((pair) => pair.poly_market_id);

  const [mappedMarketsResult, featuredMarketsResult] = await Promise.allSettled([
    fetchMappedMarkets(mappedIds),
    fetchFeaturedMarkets(6),
  ]);

  const mappedMarkets = mappedMarketsResult.status === 'fulfilled' ? mappedMarketsResult.value : [];
  const featuredMarkets = featuredMarketsResult.status === 'fulfilled' ? featuredMarketsResult.value : [];
  const diagnostics = {
    mapped_markets_ok: mappedMarketsResult.status === 'fulfilled',
    featured_markets_ok: featuredMarketsResult.status === 'fulfilled',
    warnings: [mappedMarketsResult, featuredMarketsResult]
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

  const summary = {
    mapped_pairs: store.market_pairs.length,
    ingestion_items: store.bookmaker_inputs.length,
    editable_markets: store.bookmaker_market_normalized.length,
    best_net_edge_limit: arbSnapshots[0]?.net_edge_limit ?? null,
    updated_at: new Date().toISOString(),
  };

  return {
    generatedAt: new Date().toISOString(),
    source_mode_adapters: buildBookmakerAdapters(),
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

module.exports = { buildDashboardPayload };
