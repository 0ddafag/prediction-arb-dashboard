const { createBookmakerConnector } = require('./base');

module.exports = createBookmakerConnector({
  key: 'winline',
  label: 'Winline',
  status: 'active',
  notes: 'Confirmed MLB collection route; browser extraction runs outside the Render web process.',
});
