const { createBookmakerConnector } = require('./base');

const baseConnector = createBookmakerConnector({
  key: 'ligastavok',
  label: 'Liga Stavok',
  status: 'research',
  notes: 'Qrator returned a 403 access-block page from the current host; no public odds transport has been confirmed.',
});

module.exports = Object.freeze({
  ...baseConnector,
  transport: Object.freeze({
    type: 'unconfirmed',
    website_url: 'https://www.ligastavok.ru/',
    access_from_current_host: 'qrator_403_blocked',
    public_odds_endpoint: null,
    websocket_url: null,
    bypass_attempted: false,
  }),
});
