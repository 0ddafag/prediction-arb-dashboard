# Kalshi read-only connector research

Verified: 2026-07-27 against official Kalshi documentation and live production REST responses.

## Market inventory

- Production REST base: `https://external-api.kalshi.com/trade-api/v2`.
- `GET /markets` is usable without credentials and supports status, event, series, ticker, timestamp, cursor and MVE filters. Page size is at most 1,000.
- `GET /search/filters_by_sport` exposes sport, scope and competition filters.
- A paginated `/series` snapshot contained 12,187 catalogued series, including 2,994 tagged `Sports`. This is catalogue coverage, not a claim that all series are simultaneously open.
- Sports tags observed included baseball, basketball, boxing, football, golf, hockey, MMA, soccer, table tennis, tennis, UFC and others.

Live exact-overlap probes found MLB winner markets also present on Polymarket, including Seattle–Texas, Philadelphia–Miami and Cleveland–Cincinnati. Exact settlement comparison remains mandatory before ranking.

## Orderbook and transport

- REST book: `GET /markets/{ticker}/orderbook?depth=...`.
- Despite public discovery, the orderbook endpoint currently requires the three RSA API headers: `KALSHI-ACCESS-KEY`, `KALSHI-ACCESS-SIGNATURE`, `KALSHI-ACCESS-TIMESTAMP`.
- Response uses fixed-point strings and exposes YES bids plus NO bids, not asks.
- Derived taker prices:
  - best YES ask = `1 - best NO bid`;
  - best NO ask = `1 - best YES bid`.
- Production WebSocket: `wss://external-api-ws.kalshi.com/trade-api/ws/v2`.
- The WebSocket handshake requires API-key authentication even for public market-data channels.
- `orderbook_delta` sends an initial `orderbook_snapshot`, then sequenced deltas. Clients must verify `seq`, resnapshot on gaps and explicitly set/handle `use_yes_price` because Kalshi documents a future default flip.

## Fees

General schedule effective 2026-02-05:

- taker estimate: `ceil(0.07 × contracts × price × (1-price))`;
- maker-fee products: `ceil(0.0175 × contracts × price × (1-price))`;
- ordinary resting orders are not charged unless their product is in the maker-fee schedule;
- no settlement fee;
- S&P 500 and Nasdaq-100 products use a separate `0.035` coefficient.

The API also exposes `fee_type`/`fee_multiplier` semantics and `/series/fee_changes` / `/events/fee_changes`; possible fee types include `quadratic`, `quadratic_with_maker_fees` and `flat`. Therefore the connector must not hard-code one global coefficient. Fee rounding documentation also distinguishes centicent trade-fee rounding and account-balance precision, so executed fill fees should be preferred over a pre-trade estimate when available.

## Settlement risks

MLB sample rules differed materially:

- Kalshi kept a postponed game open only when rescheduled within two days; cancellation or a later reschedule resolved to a fair price under Kalshi rules.
- The corresponding Polymarket market stayed open until completion and resolved 50/50 for a fully cancelled game or tie.

These rows require a settlement-compatibility check and may enter Top Opportunities only as explicit basis risk when rules differ. Do not match Kalshi `close_time` directly to game start: its market close may represent an expected end rather than scheduled first pitch.

## Implementation state

`src/connectors/prediction/kalshi.js` provides:

- public market discovery;
- authenticated orderbook request hook;
- YES/NO bid-book normalization;
- market-aware fee estimator;
- explicit auth and transport metadata.

It remains `read_only_research` until RSA credentials, depth sufficiency, reconnect/gap recovery and settlement mapping are wired into production.

## Primary sources

- https://docs.kalshi.com/getting_started/api_environments
- https://docs.kalshi.com/api-reference/market/get-markets
- https://docs.kalshi.com/api-reference/market/get-market-orderbook
- https://docs.kalshi.com/websockets/orderbook-updates
- https://docs.kalshi.com/api-reference/exchange/get-series-fee-changes
- https://kalshi.com/fee-schedule
