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
      status: 'stub',
      description: 'Reserved adapter contract. Returns empty data until bookmaker automation is added.',
    },
  };
}

module.exports = { buildBookmakerAdapters };
