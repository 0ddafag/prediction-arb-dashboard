const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildExactLiveMatches,
  buildLiveCollections,
  fetchLiveFonbetPolymarketSource,
  fetchFonbetSnapshotCandidates,
} = require('../src/live-fonbet-polymarket');

function polyEvent({ id, title, gameStartTime, outcomes }) {
  return {
    id: `event-${id}`,
    slug: `event-${id}`,
    title,
    active: true,
    closed: false,
    markets: [{
      id: String(id),
      question: title,
      sportsMarketType: 'moneyline',
      gameStartTime,
      outcomes: JSON.stringify(outcomes),
      clobTokenIds: JSON.stringify(['yes-token', 'no-token']),
      active: true,
      closed: false,
    }],
  };
}

const fonbetCandidates = [
  {
    venue: 'fonbet',
    provider_event_id: 101,
    sport: 'baseball',
    competition: 'MLB',
    start_at: '2026-07-27T22:40:00.000Z',
    participants: ['Детройт Тайгерс', 'Балтимор Ориолс'],
    outcomes: [
      { factor_id: 921, key: 'home', label: 'Детройт Тайгерс', decimal_odds: 1.83 },
      { factor_id: 923, key: 'away', label: 'Балтимор Ориолс', decimal_odds: 1.97 },
    ],
    source_url: 'https://fonbet.test/101',
    packet_version: 9,
  },
  {
    venue: 'fonbet',
    provider_event_id: 202,
    sport: 'ufc',
    competition: 'MMA. UFC Fight Night 283. Белград',
    start_at: '2026-08-01T17:40:00.000Z',
    participants: ['Душко Тодорович', 'Роберт Валентен'],
    outcomes: [
      { factor_id: 921, key: 'home', label: 'Душко Тодорович', decimal_odds: 2.38 },
      { factor_id: 922, key: 'draw', label: 'Draw', decimal_odds: 54 },
      { factor_id: 923, key: 'away', label: 'Роберт Валентен', decimal_odds: 1.61 },
    ],
    source_url: 'https://fonbet.test/202',
    packet_version: 10,
  },
  {
    venue: 'fonbet',
    provider_event_id: 303,
    sport: 'ufc',
    competition: 'MMA. UFC Fight Night 283. Белград',
    start_at: '2026-08-01T14:05:00.000Z',
    participants: ['Йован Лека', 'Александер Поппек'],
    outcomes: [
      { factor_id: 921, key: 'home', label: 'Йован Лека', decimal_odds: 1.42 },
      { factor_id: 923, key: 'away', label: 'Александер Поппек', decimal_odds: 2.97 },
    ],
    source_url: 'https://fonbet.test/303',
    packet_version: 10,
  },
];

const polyEvents = [
  polyEvent({
    id: 301,
    title: 'Baltimore Orioles vs. Detroit Tigers',
    gameStartTime: '2026-07-27 22:40:00+00',
    outcomes: ['Baltimore Orioles', 'Detroit Tigers'],
  }),
  polyEvent({
    id: 302,
    title: 'Baltimore Orioles vs. Detroit Tigers',
    gameStartTime: '2026-07-28 22:40:00+00',
    outcomes: ['Baltimore Orioles', 'Detroit Tigers'],
  }),
  polyEvent({
    id: 401,
    title: 'UFC Fight Night: Duško Todorovic vs. Robert Valentin',
    gameStartTime: '2026-08-01 14:00:00+00',
    outcomes: ['Duško Todorovic', 'Robert Valentin'],
  }),
  polyEvent({
    id: 402,
    title: 'UFC Fight Night: Jovan Leka vs. Max Gimenis',
    gameStartTime: '2026-08-01 14:00:00+00',
    outcomes: ['Jovan Leka', 'Max Gimenis'],
  }),
];

test('live matcher uses explicit aliases plus exact participants and event date', () => {
  const matches = buildExactLiveMatches({
    fonbetCandidates,
    polymarketEvents: polyEvents,
    now: new Date('2026-07-27T19:00:00Z'),
  });

  assert.deepEqual(matches.map((match) => [match.fonbet.provider_event_id, match.polymarket.id]), [
    [101, '301'],
    [202, '401'],
  ]);
});

test('live collections hedge each Fonbet participant with opposite Polymarket YES and retain basis risk', () => {
  const matches = buildExactLiveMatches({
    fonbetCandidates,
    polymarketEvents: polyEvents,
    now: new Date('2026-07-27T19:00:00Z'),
  });
  const collections = buildLiveCollections(matches, { capturedAt: '2026-07-27T19:01:00Z' });

  assert.equal(collections.bookmaker_market_normalized.length, 4);
  const mlbHome = collections.bookmaker_market_normalized.find((row) => row.outcome_label === 'Детройт Тайгерс');
  const mlbPair = collections.market_pairs.find((pair) => pair.bookmaker_market_id === mlbHome.bookmaker_market_id);
  assert.equal(mlbPair.poly_outcome_index, 0);
  assert.equal(mlbPair.basis_risk, 'RULES_MISMATCH');

  const ufcRows = collections.market_pairs.filter((pair) => pair.sport === 'ufc');
  assert.equal(ufcRows.length, 2);
  assert.equal(ufcRows.every((pair) => pair.basis_risk === 'DRAW_NO_CONTEST'), true);
});

test('live source fetches MLB and UFC then enriches only exact matched moneylines', async () => {
  const requestedTags = [];
  const source = await fetchLiveFonbetPolymarketSource({
    now: new Date('2026-07-27T19:00:00Z'),
    fetchCandidates: async () => fonbetCandidates,
    fetchEvents: async (tag) => {
      requestedTags.push(tag);
      return tag === 'mlb' ? polyEvents.slice(0, 2) : polyEvents.slice(2);
    },
    enrich: async (market) => ({ ...market, token_price_views: [{ buy: 0.4, sell: 0.41 }, { buy: 0.58, sell: 0.59 }] }),
  });

  assert.deepEqual(requestedTags, ['mlb', 'ufc']);
  assert.equal(source.metadata.matches, 2);
  assert.equal(source.market_pairs.length, 4);
  assert.equal(source.mapped_markets.length, 2);
  assert.equal(source.mapped_markets.every((market) => market.token_price_views.length === 2), true);
});

test('Fonbet snapshot reader validates freshness and preserves provider ids', async () => {
  const candidates = await fetchFonbetSnapshotCandidates({
    getSnapshot: async () => ({
      status: 'ok',
      captured_at: '2026-08-01T12:00:00.000Z',
      raw: { captured_at: '2026-08-01T12:00:00.000Z', candidates: fonbetCandidates },
    }),
    maxAgeMs: Number.MAX_SAFE_INTEGER,
  });
  assert.equal(candidates.length, 3);
  assert.deepEqual(candidates.map((candidate) => candidate.provider_event_id), [101, 202, 303]);
  assert.equal(candidates.every((candidate) => candidate.source_mode === 'snapshot_feed'), true);
});
