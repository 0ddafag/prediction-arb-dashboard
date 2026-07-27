function round(value, digits = 4) {
  if (value == null || Number.isNaN(value)) return null;
  const power = 10 ** digits;
  return Math.round(value * power) / power;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function impliedProbability(decimalOdds) {
  if (!decimalOdds || decimalOdds <= 1) return null;
  return 1 / decimalOdds;
}

function bookmakerThreshold(decimalOdds) {
  if (!decimalOdds || decimalOdds <= 1) return null;
  return 1 - 1 / decimalOdds;
}

function decimalOddsForTarget(polyNoCost, targetProfitPct = 0) {
  if (polyNoCost == null || polyNoCost >= 1) return null;
  const target = Number(targetProfitPct) / 100;
  const denominator = 1 - polyNoCost - target;
  if (denominator <= 0) return null;
  return 1 / denominator;
}

function feeRateFromBps(rawFee) {
  if (!rawFee || Number.isNaN(Number(rawFee))) return 0;
  return Number(rawFee) / 100000;
}

function applyFee(cost, feeRate) {
  if (cost == null) return null;
  return round(cost + feeRate * cost * (1 - cost), 4);
}

function deriveNoPriceViews(polyMarket) {
  if (!polyMarket) {
    return {
      market_exec: null,
      limit_candidate: null,
      easy_limit_candidate: null,
      easy_limit_score: null,
      best_no_bid: null,
      best_no_ask: null,
    };
  }

  const bestYesBid = Number(polyMarket.bestBid ?? polyMarket.best_bid ?? polyMarket.outcomePrices?.[0] ?? 0.5);
  const bestYesAsk = Number(polyMarket.bestAsk ?? polyMarket.best_ask ?? bestYesBid);
  const rawNoBid = clamp(1 - bestYesAsk, 0.01, 0.99);
  const rawNoAsk = clamp(1 - bestYesBid, rawNoBid, 0.99);
  const spread = rawNoAsk - rawNoBid;
  const midpoint = rawNoBid + spread / 2;
  const easyCandidate = spread >= 0.02 ? clamp(rawNoBid + 0.01, 0.01, rawNoAsk) : rawNoBid;
  const liquidity = Number(polyMarket.liquidityClob ?? polyMarket.liquidity_clob ?? 0);
  const volume24h = Number(polyMarket.volume24hr ?? polyMarket.volume_24h ?? 0);
  const score = clamp(Math.round(spread * 1400 + Math.min(liquidity / 1200, 20) + Math.min(volume24h / 2500, 20) + 22), 0, 100);

  return {
    market_exec: round(rawNoAsk),
    limit_candidate: round(rawNoBid),
    easy_limit_candidate: round(easyCandidate),
    easy_limit_score: score,
    best_no_bid: round(rawNoBid),
    best_no_ask: round(rawNoAsk),
  };
}

function buildSelectedOutcomePriceViews(pair, polyMarket) {
  const outcomeIndex = Number(pair?.poly_outcome_index);
  const selected = Number.isInteger(outcomeIndex) ? polyMarket?.token_price_views?.[outcomeIndex] : null;
  if (!selected) return null;

  const selectedSide = pair?.hedge_strategy === 'same_outcome_no' || String(pair?.poly_hedge_side || '').toUpperCase() === 'NO'
    ? 'NO'
    : 'YES';

  let marketExec;
  let limitCandidate;
  if (selectedSide === 'NO') {
    marketExec = selected.buy == null ? null : clamp(1 - Number(selected.buy), 0.01, 0.99);
    limitCandidate = selected.sell == null ? null : clamp(1 - Number(selected.sell), 0.01, 0.99);
  } else {
    marketExec = selected.sell ?? selected.mid ?? selected.buy ?? null;
    limitCandidate = selected.buy ?? selected.mid ?? marketExec;
  }
  const easyCandidate = limitCandidate;

  return {
    market_exec: round(marketExec),
    limit_candidate: round(limitCandidate),
    easy_limit_candidate: round(easyCandidate),
    easy_limit_score: 72,
    best_no_bid: selectedSide === 'NO' ? round(limitCandidate) : round(selected.buy),
    best_no_ask: selectedSide === 'NO' ? round(marketExec) : round(selected.sell),
    selected_side: selectedSide,
  };
}

function buildArbSnapshot(pair, bookmakerMarket, polyMarket) {
  const outcomeSpecificViews = buildSelectedOutcomePriceViews(pair, polyMarket);
  const derivedViews = outcomeSpecificViews || deriveNoPriceViews(polyMarket);
  const priceViews = {
    ...derivedViews,
    market_exec: pair.poly_no_market_override == null ? derivedViews.market_exec : Number(pair.poly_no_market_override),
    limit_candidate: pair.poly_no_limit_override == null ? derivedViews.limit_candidate : Number(pair.poly_no_limit_override),
  };
  priceViews.easy_limit_candidate = pair.poly_no_easy_override == null
    ? (priceViews.limit_candidate ?? derivedViews.easy_limit_candidate)
    : Number(pair.poly_no_easy_override);

  const odds = Number(bookmakerMarket.effective_decimal_odds ?? bookmakerMarket.edited_decimal_odds ?? bookmakerMarket.captured_decimal_odds);
  const impliedProb = impliedProbability(odds);
  const threshold = bookmakerThreshold(odds);
  const feeRate = feeRateFromBps(polyMarket?.takerBaseFee ?? polyMarket?.taker_base_fee ?? 0);

  const marketCostGross = priceViews.market_exec;
  const limitCostGross = priceViews.limit_candidate;
  const easyCostGross = priceViews.easy_limit_candidate;
  const marketCostNet = applyFee(marketCostGross, feeRate);
  const limitCostNet = limitCostGross == null ? null : round(limitCostGross);
  const easyCostNet = easyCostGross == null ? null : round(easyCostGross);

  const grossMarket = threshold == null || marketCostGross == null ? null : round(threshold - marketCostGross);
  const grossLimit = threshold == null || limitCostGross == null ? null : round(threshold - limitCostGross);
  const grossEasy = threshold == null || easyCostGross == null ? null : round(threshold - easyCostGross);

  const netMarket = threshold == null || marketCostNet == null ? null : round(threshold - marketCostNet);
  const netLimit = threshold == null || limitCostNet == null ? null : round(threshold - limitCostNet);
  const netEasy = threshold == null || easyCostNet == null ? null : round(threshold - easyCostNet);

  const maxExecutableSize = round(Math.min(
    Number(polyMarket?.liquidityClob ?? polyMarket?.liquidity_clob ?? 0),
    Number(polyMarket?.volume24hr ?? polyMarket?.volume_24h ?? 0) || Number(polyMarket?.liquidityClob ?? 0)
  ), 2);

  return {
    arb_snapshot_id: `${pair.pair_id}:${Date.now()}`,
    pair_id: pair.pair_id,
    sport: pair.sport || bookmakerMarket.sport || null,
    market_family: pair.market_family || bookmakerMarket.market_family || null,
    settlement_scope: pair.settlement_scope || null,
    hedge_strategy: pair.hedge_strategy || null,
    basis_risk: pair.basis_risk || 'NONE',
    bookmaker_decimal_odds: odds,
    bookmaker_implied_prob: impliedProb,
    poly_no_market_exec: marketCostGross,
    poly_no_limit_candidate: limitCostGross,
    poly_no_easy_limit_candidate: easyCostGross,
    gross_edge_market: grossMarket,
    gross_edge_limit: grossLimit,
    gross_edge_easy_limit: grossEasy,
    net_edge_market: netMarket,
    net_edge_limit: netLimit,
    net_edge_easy_limit: netEasy,
    max_executable_size: maxExecutableSize,
    stale_flag: false,
    calc_notes: feeRate ? `Net edges use feeRate≈${round(feeRate * 100, 2)}%.` : 'No taker fee applied.',
    computed_at: new Date().toISOString(),
    price_views: {
      ...priceViews,
      derived_market_exec: derivedViews.market_exec,
      derived_limit_candidate: derivedViews.limit_candidate,
      derived_easy_limit_candidate: derivedViews.easy_limit_candidate,
      market_net: marketCostNet,
      limit_net: limitCostNet,
      easy_net: easyCostNet,
      threshold,
      breakeven_odds: {
        market_exec: decimalOddsForTarget(marketCostNet, 0),
        limit_candidate: decimalOddsForTarget(limitCostNet, 0),
        easy_limit_candidate: decimalOddsForTarget(easyCostNet, 0),
      }
    }
  };
}

module.exports = {
  round,
  impliedProbability,
  bookmakerThreshold,
  decimalOddsForTarget,
  deriveNoPriceViews,
  buildArbSnapshot,
};
