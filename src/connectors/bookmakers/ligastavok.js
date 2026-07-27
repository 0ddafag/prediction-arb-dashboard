const { createBookmakerConnector } = require('./base');

module.exports = createBookmakerConnector({
  key: 'ligastavok',
  label: 'Liga Stavok',
  status: 'research',
  notes: 'Read-only network and geo reconnaissance required before confirming coverage routes.',
});
