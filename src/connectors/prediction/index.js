const { kalshiConnector } = require('./kalshi');
const { predictFunConnector } = require('./predictfun');

const predictionConnectors = Object.freeze({
  kalshi: kalshiConnector,
  predictfun: predictFunConnector,
});

function listPredictionConnectors() {
  return Object.values(predictionConnectors);
}

function getPredictionConnector(key) {
  return predictionConnectors[key] || null;
}

module.exports = {
  predictionConnectors,
  listPredictionConnectors,
  getPredictionConnector,
};
