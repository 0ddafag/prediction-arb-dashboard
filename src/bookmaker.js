const BOOKMAKERS = Object.freeze([
  { key: 'winline', label: 'Winline', status: 'seed' },
  { key: 'fonbet', label: 'Fonbet', status: 'active' },
  { key: 'ligastavok', label: 'Liga Stavok', status: 'planned' },
]);

function listBookmakers() {
  return BOOKMAKERS.map((item) => ({ ...item }));
}

function getBookmakerLabel(key) {
  return BOOKMAKERS.find((item) => item.key === key)?.label || key || 'Unknown';
}

function buildBookmakerAdapters() {
  return {
    screenshot_manual: {
      key: 'screenshot_manual',
      label: 'Screenshot/manual',
      status: 'active',
      description: 'Stores screenshot-assisted raw capture and manual corrections in the same downstream contract.',
    },
    machine_fetch: {
      key: 'machine_fetch',
      label: 'Machine fetch',
      status: 'active',
      description: 'Read-only public client transport collector.',
    },
    browser_public_transport: {
      key: 'browser_public_transport',
      label: 'Browser-observed public transport',
      status: 'active',
      description: 'Current Fonbet odds from the public browser client line route; no login or betting actions.',
    },
  };
}

module.exports = { BOOKMAKERS, listBookmakers, getBookmakerLabel, buildBookmakerAdapters };
