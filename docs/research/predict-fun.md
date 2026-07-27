# Predict.fun read-only connector research

Verified: 2026-07-27 against Predict.fun documentation, live public GraphQL responses and documented REST/WebSocket schemas.

## Market inventory

A live paginated query to `https://graphql.predict.fun/graphql` returned 476 `OPEN` categories and 2,559 markets:

| Variant | Open categories |
| --- | ---: |
| DEFAULT | 190 |
| SPORTS_MATCH | 92 |
| SPORTS_TEAM_MATCH | 79 |
| SPORTS_PROPS | 11 |
| ESPORTS_LOL | 75 |
| ESPORTS_CS2 | 15 |
| CRYPTO_UP_DOWN | 12 |
| TWEET_COUNT | 2 |

The 182 sports categories contained 483 markets. Current observed sports tags were soccer/football and baseball/MLB; this snapshot did not confirm current UFC, tennis or basketball coverage.

The public GraphQL endpoint is used by the website but is not the documented stable developer contract. It is therefore marked `public_undocumented_graphql` and should be treated as discovery-only with schema monitoring.

## Documented API and orderbook

- Production REST: `https://api.predict.fun`.
- Market discovery: `GET /v1/markets`.
- Book: `GET /v1/markets/{id}/orderbook`.
- Both documented endpoints require `x-api-key`.
- The orderbook stores YES-side levels only:
  - `asks`: ascending `[YES price, shares]`;
  - `bids`: descending `[YES price, shares]`.
- NO depth is derived at the market decimal precision by swapping sides and complementing prices:
  - NO bids = complemented YES asks;
  - NO asks = complemented YES bids.
- Precision must come from the market. Raw floating-point `1-price` without rounding can produce invalid levels.

## WebSocket

- URL: `wss://ws.predict.fun/ws`.
- API key is required in `x-api-key` or the `apiKey` query parameter.
- Live orderbook topic: `predictOrderbook/{marketId}`.
- Subscription normally returns the latest snapshot followed by updates.
- The server sends a heartbeat every 15 seconds and expects it to be echoed; clients must reconnect with backoff and resubscribe.
- The orderbook payload includes `settlementsPending`; pending on-chain settlement must not be counted as freely reusable depth.

## Fees

Official fee page:

- makers pay 0;
- default taker base fee is 2%, with effective percentage ranging from 0.018% to 2% depending on share price and an optional 10% discount;
- raw fee = `base fee × min(price, 1-price) × shares`;
- minimum order value is 1 USDT.

The live GraphQL snapshot reported `makerFeeBps=0` and `takerFeeBps=200` for all 2,559 observed markets. Connector calculations use the per-market values rather than assuming they can never change.

A temporary maker-rebate programme documented for eligible UP/DOWN crypto markets pays the maker 25% of the taker fee and is scheduled to end 2026-09-16. Rebate eligibility must be a market attribute, not a permanent global rule.

## Architecture and settlement

- Hybrid CLOB: off-chain matching, on-chain BNB Chain execution/settlement using USDT-backed conditional tokens.
- Multi-outcome categories use a NegRisk system; a NO position can have conversion semantics across complementary outcomes.
- 174 of 476 current categories were marked NegRisk; 381 were yield-bearing.
- Current resolution-provider distribution was 445 `THREE_PO`, 25 `PREDICT_DOT_FUN`, 6 `CHAINLINK`.
- Predict documentation says all new markets since March 2026 use UMA Optimistic Oracle. Undisputed resolution is roughly two hours; disputes can extend to a week.
- Technical documentation also describes permissioned operator/admin paths and yield-bearing collateral via Venus. These introduce oracle, operator, on-chain settlement and collateral/yield risks beyond simple title matching.

Every cross-venue match must compare the exact question, source, timing, cancellation/retirement/overtime clauses and resolution path. Shared UMA infrastructure does not guarantee identical wording or settlement.

## Implementation state

`src/connectors/prediction/predictfun.js` provides:

- working public website GraphQL discovery;
- documented API-key REST hooks;
- YES-book/derived-NO normalization;
- per-market fee calculation;
- explicit auth and transport metadata.

It remains `read_only_research` until an official API key is supplied and depth, heartbeat/reconnect, `settlementsPending`, NegRisk and settlement compatibility are wired into production ranking.

## Primary sources

- https://docs.predict.fun/the-basics/predict-fees-and-limits
- https://docs.predict.fun/knowledge-base/maker-rebates
- https://docs.predict.fun/knowledge-base/how-resolution-works-on-predict
- https://docs.predict.fun/developers/technical-overview
- https://dev.predict.fun/get-markets-25326905e0
- https://dev.predict.fun/get-the-orderbook-for-a-market-25326908e0
- https://dev.predict.fun/understanding-the-orderbook-685654m0
- https://dev.predict.fun/general-information-1915499m0
- https://dev.predict.fun/subscription-topics-1915507m0
