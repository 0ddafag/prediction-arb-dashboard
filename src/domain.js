const SPORTS = Object.freeze({
  BASEBALL: 'baseball',
  UFC: 'ufc',
  TENNIS: 'tennis',
  FOOTBALL: 'football',
  BASKETBALL: 'basketball',
});

const MARKET_FAMILIES = Object.freeze({
  MONEYLINE_2WAY: 'moneyline_2way',
  FOOTBALL_1X2: 'football_1x2',
  MATCH_WINNER_INCLUDING_OT: 'match_winner_including_ot',
  REGULATION_RESULT: 'regulation_result',
});

const HEDGE_STRATEGIES = Object.freeze({
  OPPOSITE_YES: 'opposite_yes',
  SAME_OUTCOME_NO: 'same_outcome_no',
});

const BASIS_RISKS = Object.freeze({
  NONE: 'NONE',
  OVERTIME: 'OVERTIME',
  RETIREMENT: 'RETIREMENT',
  DRAW_NO_CONTEST: 'DRAW_NO_CONTEST',
  RULES_MISMATCH: 'RULES_MISMATCH',
});

const SPORT_TABS = Object.freeze([
  { key: SPORTS.BASEBALL, label: 'MLB' },
  { key: SPORTS.UFC, label: 'UFC' },
  { key: SPORTS.TENNIS, label: 'Tennis' },
  { key: SPORTS.FOOTBALL, label: 'Football' },
  { key: SPORTS.BASKETBALL, label: 'Basketball' },
]);

function defaultHedgeStrategy(sport, marketFamily) {
  if (sport === SPORTS.FOOTBALL && marketFamily === MARKET_FAMILIES.FOOTBALL_1X2) {
    return HEDGE_STRATEGIES.SAME_OUTCOME_NO;
  }
  if ([SPORTS.BASEBALL, SPORTS.UFC, SPORTS.TENNIS].includes(sport) && marketFamily === MARKET_FAMILIES.MONEYLINE_2WAY) {
    return HEDGE_STRATEGIES.OPPOSITE_YES;
  }
  if (sport === SPORTS.BASKETBALL && marketFamily === MARKET_FAMILIES.MATCH_WINNER_INCLUDING_OT) {
    return HEDGE_STRATEGIES.OPPOSITE_YES;
  }
  return null;
}

function validateMapping(mapping) {
  if (!Object.values(SPORTS).includes(mapping.sport)) throw new Error(`Unsupported sport: ${mapping.sport}`);
  if (!Object.values(HEDGE_STRATEGIES).includes(mapping.hedge_strategy)) {
    throw new Error(`Unsupported hedge strategy: ${mapping.hedge_strategy}`);
  }
  if (!mapping.settlement_scope) throw new Error('settlement_scope is required');
  if (!Object.values(BASIS_RISKS).includes(mapping.basis_risk || BASIS_RISKS.NONE)) {
    throw new Error(`Unsupported basis risk: ${mapping.basis_risk}`);
  }

  const expected = defaultHedgeStrategy(mapping.sport, mapping.market_family);
  if (expected && mapping.hedge_strategy !== expected) {
    throw new Error(`${mapping.market_family} for ${mapping.sport} must use ${expected}`);
  }
  return true;
}

module.exports = {
  SPORTS,
  SPORT_TABS,
  MARKET_FAMILIES,
  HEDGE_STRATEGIES,
  BASIS_RISKS,
  defaultHedgeStrategy,
  validateMapping,
};
