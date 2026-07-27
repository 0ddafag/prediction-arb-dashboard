const fs = require('fs');
const path = require('path');
const { listBookmakers } = require('./bookmaker');
const { SPORT_TABS } = require('./domain');

const COVERAGE_PATH = path.join(__dirname, '..', 'config', 'coverage-map.json');
const STATUSES = new Set(['confirmed', 'candidate', 'no_intersection', 'blocked']);

function validateCoverageRule(rule) {
  const venueKeys = new Set(listBookmakers().map((item) => item.key));
  const sportKeys = new Set(SPORT_TABS.map((item) => item.key));
  if (!venueKeys.has(rule.venue)) throw new Error(`Unsupported venue: ${rule.venue}`);
  if (!sportKeys.has(rule.sport)) throw new Error(`Unsupported sport: ${rule.sport}`);
  if (!STATUSES.has(rule.intersection_status)) throw new Error(`Unsupported intersection_status: ${rule.intersection_status}`);
  if (!rule.geo) throw new Error('geo is required');
  if (!rule.competition) throw new Error('competition is required');
  if (!rule.market_family) throw new Error('market_family is required');
  if (!rule.settlement_scope) throw new Error('settlement_scope is required');
  if (rule.intersection_status === 'confirmed' && !rule.source_path) {
    throw new Error('source_path is required for confirmed coverage');
  }
  return true;
}

function loadCoverageMap() {
  const rules = JSON.parse(fs.readFileSync(COVERAGE_PATH, 'utf8'));
  if (!Array.isArray(rules)) throw new Error('coverage map must be an array');
  rules.forEach(validateCoverageRule);
  return rules;
}

function shouldCollectCoverage(rule, mode = 'sync') {
  if (mode === 'audit') return ['confirmed', 'candidate', 'no_intersection'].includes(rule.intersection_status);
  return rule.intersection_status === 'confirmed';
}

function findCoverageRules({ venue = null, sport = null, mode = 'sync' } = {}) {
  return loadCoverageMap().filter((rule) => {
    if (venue && rule.venue !== venue) return false;
    if (sport && rule.sport !== sport) return false;
    return shouldCollectCoverage(rule, mode);
  });
}

module.exports = {
  COVERAGE_PATH,
  loadCoverageMap,
  findCoverageRules,
  shouldCollectCoverage,
  validateCoverageRule,
};
