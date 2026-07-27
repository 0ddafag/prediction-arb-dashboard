const winline = require('./winline');
const fonbet = require('./fonbet');
const ligastavok = require('./ligastavok');

const CONNECTORS = Object.freeze([winline, fonbet, ligastavok]);

function listBookmakerConnectors() {
  return [...CONNECTORS];
}

function getBookmakerConnector(key) {
  const connector = CONNECTORS.find((item) => item.key === key);
  if (!connector) throw new Error(`Unknown bookmaker connector: ${key}`);
  return connector;
}

module.exports = { listBookmakerConnectors, getBookmakerConnector };
