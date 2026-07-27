const { createBookmakerConnector } = require('./base');

module.exports = createBookmakerConnector({
  key: 'fonbet',
  label: 'Fonbet',
  status: 'research',
  notes: 'Read-only network and geo reconnaissance required before confirming coverage routes.',
});
