const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseWinlineText,
  fetchLiveWinlinePolymarketSource,
} = require('../src/live-winline-polymarket');
const { mergeSources } = require('../src/live-sportsbook-polymarket');

const now = new Date('2026-07-27T23:20:00Z');

function market(id, sport, outcomes, start) {
  return {
    id,
    active: true,
    closed: false,
    markets: [{
      id,
      sportsMarketType: 'moneyline',
      active: true,
      closed: false,
      outcomes: JSON.stringify(outcomes),
      gameStartTime: start,
    }],
  };
}

test('Winline rendered text parser extracts MLB and UFC moneyline rows', () => {
  const mlbText = `Бейсбол\nСША\nMLB\nЧикаго Уайт Сокс\nН-Й Янкис\nСегодня 23:40\n+62\nМатч\n2.24\n1.72\n1.70\n+ 1.5 -`;
  const ufcText = `ММА\nUFC\nМедич У.\nРодригез Д.\n01.08.26 18:20\n+4\nМатч\n1.29\n45.0\n3.85\n-`;
  const mlb = parseWinlineText(mlbText, { sport: 'baseball', now });
  const ufc = parseWinlineText(ufcText, { sport: 'ufc', now });
  assert.equal(mlb.length, 1);
  assert.equal(mlb[0].participants.join(' — '), 'Чикаго Уайт Сокс — Н-Й Янкис');
  assert.equal(mlb[0].outcomes[0].decimal_odds, 2.24);
  assert.equal(mlb[0].outcomes[1].decimal_odds, 1.72);
  assert.equal(ufc.length, 1);
  assert.deepEqual(ufc[0].outcomes.map((row) => row.key), ['home', 'draw', 'away']);
});

test('Winline live source maps exact rows and keeps Winline-specific IDs', async () => {
  const source = await fetchLiveWinlinePolymarketSource({
    now,
    fetchCandidates: async () => parseWinlineText(`Бейсбол\nСША\nMLB\nЧикаго Уайт Сокс\nН-Й Янкис\nСегодня 23:40\n+62\nМатч\n2.24\n1.72\n1.70`, { sport: 'baseball', now }),
    fetchEvents: async () => [market('poly-nyy-cws', 'baseball', ['Chicago White Sox', 'New York Yankees'], '2026-07-27T23:40:00Z')],
    enrich: async (item) => ({ ...item, token_price_views: [{ buy: 0.45, sell: 0.46 }, { buy: 0.52, sell: 0.53 }] }),
  });
  assert.equal(source.metadata.source, 'winline_live_browser_dom');
  assert.equal(source.market_pairs.length, 2);
  assert.ok(source.market_pairs.every((pair) => pair.pair_id.startsWith('pair-live-winline-')));
  assert.ok(source.bookmaker_market_normalized.every((row) => row.bookmaker_key === 'winline'));
});

test('multi-source merge preserves Fonbet and Winline rows without seed fallback', () => {
  const merged = mergeSources([
    { status: 'fulfilled', value: { bookmaker_inputs: [{ input_id: 'f' }], bookmaker_market_normalized: [{ bookmaker_market_id: 'bm-live-fonbet-x' }], market_pairs: [{ pair_id: 'pair-live-fonbet-x' }], mapped_markets: [{ id: '1' }], metadata: { captured_at: '2026-07-27T00:00:00Z', matches_by_sport: { baseball: 1 } } } },
    { status: 'fulfilled', value: { bookmaker_inputs: [{ input_id: 'w' }], bookmaker_market_normalized: [{ bookmaker_market_id: 'bm-live-winline-x' }], market_pairs: [{ pair_id: 'pair-live-winline-x' }], mapped_markets: [{ id: '2' }], metadata: { captured_at: '2026-07-27T00:00:01Z', matches_by_sport: { ufc: 1 } } } },
  ]);
  assert.equal(merged.bookmaker_inputs.length, 2);
  assert.deepEqual(merged.metadata.matches_by_sport, { baseball: 1, ufc: 1 });
  assert.equal(merged.metadata.source, 'multi_live_sportsbook');
});
