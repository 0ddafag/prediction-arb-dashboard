const test = require('node:test');
const assert = require('node:assert/strict');
const {
  loadCoverageMap,
  findCoverageRules,
  shouldCollectCoverage,
  validateCoverageRule,
} = require('../src/coverage');

test('coverage map stores URL, geo, competition and market family for confirmed overlaps', () => {
  const rules = loadCoverageMap();
  const mlb = rules.find((rule) => rule.venue === 'winline' && rule.competition === 'MLB');
  assert.ok(mlb);
  assert.equal(mlb.sport, 'baseball');
  assert.equal(mlb.geo, 'US');
  assert.equal(mlb.market_family, 'moneyline_2way');
  assert.match(mlb.source_path, /^https:\/\/winline\.ru\//);
  assert.equal(mlb.intersection_status, 'confirmed');
});

test('normal sync collects only confirmed coverage and audit may revisit candidates', () => {
  assert.equal(shouldCollectCoverage({ intersection_status: 'confirmed' }, 'sync'), true);
  assert.equal(shouldCollectCoverage({ intersection_status: 'candidate' }, 'sync'), false);
  assert.equal(shouldCollectCoverage({ intersection_status: 'candidate' }, 'audit'), true);
  assert.equal(shouldCollectCoverage({ intersection_status: 'no_intersection' }, 'sync'), false);
  assert.equal(shouldCollectCoverage({ intersection_status: 'no_intersection' }, 'audit'), true);
});

test('coverage lookup filters by venue and sport without fuzzy matching', () => {
  const rules = findCoverageRules({ venue: 'winline', sport: 'baseball', mode: 'sync' });
  assert.ok(rules.length >= 1);
  assert.equal(rules.every((rule) => rule.venue === 'winline' && rule.sport === 'baseball'), true);
  const fonbetMlb = findCoverageRules({ venue: 'fonbet', sport: 'baseball', mode: 'sync' });
  const fonbetUfc = findCoverageRules({ venue: 'fonbet', sport: 'ufc', mode: 'sync' });
  assert.equal(fonbetMlb.length, 1);
  assert.equal(fonbetUfc.length, 1);
  assert.equal(findCoverageRules({ venue: 'fonbet', sport: 'tennis', mode: 'sync' }).length, 0);
});

test('coverage rule validation rejects incomplete confirmed intersections', () => {
  assert.throws(() => validateCoverageRule({
    venue: 'winline',
    sport: 'baseball',
    geo: 'US',
    competition: 'MLB',
    market_family: 'moneyline_2way',
    settlement_scope: 'full_game',
    intersection_status: 'confirmed',
  }), /source_path/);
});
