function isPostgresConfigured(env = process.env) {
  return Boolean(String(env.DATABASE_URL || '').trim());
}

function buildStoreSnapshotRows(store) {
  const inputs = new Map((store.bookmaker_inputs || []).map((item) => [item.input_id, item]));
  const canonicalEventsMap = new Map();

  const bookmakerMarkets = (store.bookmaker_market_normalized || []).map((market) => {
    const input = inputs.get(market.input_id) || {};
    const eventKey = [market.sport, market.event_title, market.event_start_at].join('|');
    if (!canonicalEventsMap.has(eventKey)) {
      canonicalEventsMap.set(eventKey, {
        event_key: eventKey,
        sport: market.sport,
        title: market.event_title,
        start_at: market.event_start_at,
        status: 'upcoming',
      });
    }
    return {
      ...market,
      event_key: eventKey,
      source_ref: input.source_ref || null,
      raw_payload: input,
    };
  });

  const predictionMarkets = [...new Map((store.market_pairs || []).map((pair) => [String(pair.poly_market_id), {
    venue: 'polymarket',
    external_market_id: String(pair.poly_market_id),
  }])).values()];

  const marketMappings = (store.market_pairs || []).map((pair) => ({
    ...pair,
    bookmaker_key: pair.bookmaker_key || 'winline',
    prediction_venue: 'polymarket',
    sport: pair.sport || 'baseball',
    market_family: pair.market_family || 'moneyline_2way',
    settlement_scope: pair.settlement_scope || 'full_game',
    hedge_strategy: pair.hedge_strategy || 'opposite_yes',
    basis_risk: pair.basis_risk || 'NONE',
  }));

  const quotes = bookmakerMarkets.map((market) => ({
    venue: market.bookmaker_key,
    market_ref: market.bookmaker_market_id,
    quote_type: 'decimal_odds',
    price: market.effective_decimal_odds,
    captured_at: market.normalized_at,
    raw_payload: null,
  }));

  return {
    canonicalEvents: [...canonicalEventsMap.values()],
    bookmakerMarkets,
    predictionMarkets,
    marketMappings,
    quotes,
  };
}

module.exports = {
  isPostgresConfigured,
  buildStoreSnapshotRows,
};
