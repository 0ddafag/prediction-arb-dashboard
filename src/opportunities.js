const CATEGORY_PRIORITY = Object.freeze({
  market: 0,
  limit: 1,
  basis_risk: 2,
});

function normalizeRisk(row) {
  return String(row?.pair?.basis_risk || 'NONE').toUpperCase();
}

function classifyOpportunity(row) {
  const marketEdge = Number(row?.net_edge_market);
  const limitEdge = Number(row?.net_edge_limit);
  const hasMarket = Number.isFinite(marketEdge) && marketEdge > 0;
  const hasLimit = Number.isFinite(limitEdge) && limitEdge > 0;
  if (!hasMarket && !hasLimit) return null;
  if (normalizeRisk(row) !== 'NONE') return 'basis_risk';
  return hasMarket ? 'market' : 'limit';
}

function opportunityEdge(row, category = classifyOpportunity(row)) {
  if (category === 'market') return Number(row.net_edge_market);
  if (category === 'limit') return Number(row.net_edge_limit);
  return Math.max(Number(row.net_edge_market) || -Infinity, Number(row.net_edge_limit) || -Infinity);
}

function sortTopOpportunities(rows) {
  return rows
    .map((row) => ({ ...row, opportunity_category: classifyOpportunity(row) }))
    .filter((row) => row.opportunity_category && !row.stale_flag)
    .sort((left, right) => {
      const categoryDiff = CATEGORY_PRIORITY[left.opportunity_category] - CATEGORY_PRIORITY[right.opportunity_category];
      if (categoryDiff) return categoryDiff;
      return opportunityEdge(right, right.opportunity_category) - opportunityEdge(left, left.opportunity_category);
    });
}

module.exports = {
  classifyOpportunity,
  opportunityEdge,
  sortTopOpportunities,
};
