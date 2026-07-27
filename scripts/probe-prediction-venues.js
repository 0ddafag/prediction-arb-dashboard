const { fetchKalshiMarkets } = require('../src/connectors/prediction/kalshi');
const { fetchPredictPublicCategories } = require('../src/connectors/prediction/predictfun');

async function main() {
  const [kalshi, predict] = await Promise.all([
    fetchKalshiMarkets({ status: 'open', limit: 5 }),
    fetchPredictPublicCategories({ first: 5 }),
  ]);

  const report = {
    checked_at: new Date().toISOString(),
    kalshi: {
      open_market_sample_size: kalshi.markets?.length || 0,
      has_more: Boolean(kalshi.cursor),
      sample: (kalshi.markets || []).map((market) => ({ ticker: market.ticker, title: market.title })),
    },
    predictfun: {
      open_categories_total: predict.totalCount,
      sample_size: predict.edges.length,
      has_more: predict.pageInfo.hasNextPage,
      sample: predict.edges.map(({ node }) => ({
        id: node.id,
        title: node.title,
        variant: node.marketVariant,
        market_ids: node.markets.edges.map(({ node: market }) => market.id),
      })),
    },
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
