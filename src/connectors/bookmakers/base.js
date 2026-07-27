const { findCoverageRules } = require('../../coverage');

function createBookmakerConnector({ key, label, status, notes }) {
  return Object.freeze({
    key,
    label,
    status,
    notes,
    coverage({ sport = null, mode = 'sync' } = {}) {
      return findCoverageRules({ venue: key, sport, mode });
    },
    async collect() {
      throw new Error(`${label} collector is not wired into the web process; use the external read-only collector.`);
    },
  });
}

module.exports = { createBookmakerConnector };
