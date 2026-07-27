const { loadCoverageMap } = require('../src/coverage');

const rules = loadCoverageMap();
const byStatus = rules.reduce((acc, rule) => {
  acc[rule.intersection_status] = (acc[rule.intersection_status] || 0) + 1;
  return acc;
}, {});

console.log(JSON.stringify({
  total: rules.length,
  by_status: byStatus,
  confirmed: rules
    .filter((rule) => rule.intersection_status === 'confirmed')
    .map(({ venue, sport, geo, competition, market_family, source_path }) => ({
      venue, sport, geo, competition, market_family, source_path,
    })),
}, null, 2));
