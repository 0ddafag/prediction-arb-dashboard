# Multi-sport / Multi-bookmaker Prediction Arb Dashboard — Implementation Plan

**Date:** 2026-07-27
**Production:** https://prediction-arb-dashboard.onrender.com/
**Repository:** `/home/test1/prediction-arb-dashboard`
**Branch at planning:** `main` @ `e61d6be`

## Goal

Extend the existing Polymarket ↔ bookmaker dashboard into an extensible multi-sport, multi-bookmaker comparison system while preserving the current compact spreadsheet UI and manual override UX.

Initial dimensions:

- Sports: MLB/baseball, UFC, tennis, football, basketball.
- Bookmakers: Winline, Fonbet, Liga Stavok.
- Prediction venues now: Polymarket only.
- Prediction venues researched for later: Kalshi, Predict.fun.
- Global view: `Top Opportunities` with positive executable market arbs, positive limit-order candidates and clearly labeled basis-risk opportunities, sorted descending inside each category.
- Render only markets that have an exact or explicitly approved mapping to Polymarket.

## Non-negotiable matching rules

### Shared

1. Never fuzzy-match a merely similar event into production rows.
2. A displayed row requires:
   - canonical event identity;
   - compatible start time;
   - compatible settlement scope;
   - explicit outcome/hedge strategy;
   - fresh quote from both venues.
3. Every mapping stores the rules text or a short settlement caveat.
4. `Market` means immediately executable price including taker fee.
5. `Limit` means resting maker price; do not rank it as guaranteed arbitrage.
6. Manual price edits remain possible and must not break cursor/focus or dot/comma decimal entry.

### MLB, UFC, tennis — two-way winner markets

- Bookmaker outcome `A` is hedged with the opposite participant's Polymarket `YES` outcome.
- UFC: ignore a separate draw outcome for the core two-way calculation; draw/no-contest settlement mismatches remain visible only as explicitly labeled basis-risk opportunities.
- Tennis: record retirement/walkover settlement compatibility; incompatible rules may remain visible as labeled basis-risk opportunities.

### Football — 1X2

For each bookmaker outcome `Home`, `Draw`, `Away`:

- hedge with `NO` on the **same Polymarket outcome question**;
- do **not** synthesize the hedge by buying `YES` on the other two outcomes;
- produce one row per 1X2 outcome;
- regulation-time scope must match exactly.

Strategy key: `same_outcome_no`.

### Basketball

Support two distinct market families:

1. `match_winner_including_ot` — winner including overtime, normally two-way.
2. `regulation_result` — result at the end of regulation; may include a draw/tie outcome depending on bookmaker presentation.

Do not silently mix them. If a regulation-only leg is compared with an including-OT leg, mark `basis_risk=OVERTIME`; it may appear in `Top Opportunities`, but only in the visible basis-risk category.

## Current architecture audit

Current implementation is an MVP and needs a domain layer before adding more tabs:

- `data/store.json` combines raw inputs, normalized bookmaker rows and market pairs.
- `src/dashboard.js` assumes one global list and fetches only mapped Polymarket markets.
- `src/math.js` supports generic `NO` derivation and outcome-index pricing, but has no explicit strategy or settlement-scope model.
- `src/bookmaker.js` contains adapter descriptions only, not actual venue connectors.
- `public/app.js` assumes MLB in several labels and has no sport/bookmaker state.
- Runtime edits are written to local JSON, which is not durable on Render.
- The web process and future browser collectors are not separated.

Therefore the implementation order must be: domain contract → durable storage → connectors/matching → API → UI.

---

## Phase 1 — Lock current behavior and fix venue naming

### Task 1.1 — Add regression tests for the current MLB table

**Files:**

- Modify: `test/server.test.js`
- Create: `test/dashboard.test.js`

**Tests:**

- payload rows expose `bookmaker_key` and display label `Winline`;
- current MLB rows remain mapped;
- `market` includes taker fee while `limit` is maker/bid price;
- manual bookmaker and Polymarket overrides survive a reload;
- no row-level stake/FX fields reappear.

Run:

```bash
npm test
```

### Task 1.2 — Normalize bookmaker labels

**Files:**

- Modify: `src/bookmaker.js`
- Modify: `src/dashboard.js`
- Modify: `public/app.js`

Add a registry:

```js
winline -> Winline
fonbet -> Fonbet
ligastavok -> Liga Stavok
```

UI must derive `Book name` from `bookmaker_key`; remove seed/source-dependent display logic such as `Browser live`.

**Acceptance:** every current production MLB row shows `Winline`.

---

## Phase 2 — Canonical domain model and durable storage

### Task 2.1 — Define explicit domain enums and validation

**Create:** `src/domain.js`

Enums/contracts:

- `sport_key`: `baseball`, `ufc`, `tennis`, `football`, `basketball`;
- `market_family`: `moneyline_2way`, `football_1x2`, `match_winner_including_ot`, `regulation_result`;
- `settlement_scope`: `full_game`, `including_ot`, `regulation`, `match`, `fight`;
- `hedge_strategy`: `opposite_yes`, `same_outcome_no`;
- `basis_risk`: `NONE`, `OVERTIME`, `RETIREMENT`, `DRAW_NO_CONTEST`, `RULES_MISMATCH`;
- mapping status: `mapped`, `candidate`, `rejected`, `stale`.

Add validation that prevents a row from reaching the dashboard without a supported strategy and settlement scope.

### Task 2.2 — Introduce storage interface

**Modify:** `src/storage.js`
**Create:**

- `src/storage/file-store.js`
- `src/storage/postgres-store.js`
- `migrations/001_core.sql`
- `scripts/migrate-store-json.js`

The web app calls an abstract repository; local file remains a development fallback only.

Minimum tables:

- `venues`;
- `canonical_events`;
- `canonical_markets`;
- `bookmaker_markets`;
- `prediction_markets`;
- `market_mappings`;
- `quotes`;
- `manual_overrides`;
- `coverage_rules`;
- `sync_runs`.

Important columns in `market_mappings`:

- bookmaker venue/market/outcome IDs;
- prediction venue/market/token IDs;
- sport and market family;
- hedge strategy;
- settlement scope;
- basis risk;
- confidence and approval status;
- rules/caveat text;
- first/last seen timestamps.

### Task 2.3 — Migrate existing MLB seed

**Files:**

- Run/verify: `scripts/migrate-store-json.js`
- Keep: `data/store.json` as a backup fixture, not runtime state.

Verification queries:

- 12 canonical events;
- 24 bookmaker outcome rows;
- 24 approved Polymarket mappings;
- manual overrides preserved.

**Production prerequisite:** provision Postgres (Render Postgres, Supabase or Neon) and set `DATABASE_URL` as a Render secret. Do not commit credentials.

---

## Phase 3 — Coverage map: URLs + geographies + market types

### Task 3.1 — Create machine-readable coverage seed

**Create:**

- `config/coverage-map.json`
- `src/coverage.js`
- `docs/coverage-map.md`

Each rule contains:

```json
{
  "venue": "winline",
  "sport": "baseball",
  "geo": "US",
  "competition": "MLB",
  "market_family": "moneyline_2way",
  "source_path": "https://winline.ru/stavki/sport/bejsbol/ssha/mlb",
  "intersection_status": "confirmed",
  "last_checked_at": "...",
  "last_matched_at": "...",
  "recheck_policy": "periodic"
}
```

Status values:

- `confirmed`: historically matched Polymarket;
- `candidate`: needs rules review;
- `no_intersection`: checked, currently no matching Polymarket market;
- `blocked`: inaccessible or auth/geofence blocker.

### Task 3.2 — Use the map to limit collection

Collectors only visit `confirmed` and explicitly requested `candidate` routes. `no_intersection` routes are skipped during normal sync and revisited only by a separate coverage-audit command.

Commands to create:

```bash
npm run sync -- --venue winline --sport baseball
npm run coverage:audit -- --venue fonbet --sport football
```

No recurring schedule will be created or changed without separate approval.

### Task 3.3 — Record observed overlap automatically

On each sync:

- update `last_checked_at`;
- update `last_matched_at` when an approved intersection is found;
- store counts of scanned, matched, rejected and stale markets;
- never promote a fuzzy candidate to `confirmed` automatically.

---

## Phase 4 — Bookmaker connector layer

### Task 4.1 — Common connector contract

**Create:**

- `src/connectors/bookmakers/base.js`
- `src/connectors/bookmakers/normalize.js`
- `scripts/sync-bookmaker.js`

Every connector emits the same shape:

```text
venue, sport, geo, competition, event_ref, event_title,
participants, start_at, market_family, settlement_scope,
outcome_key, outcome_label, decimal_odds, source_url, captured_at
```

### Task 4.2 — Winline connector

**Create:** `src/connectors/bookmakers/winline.js`

Start with the proven Playwright DOM/network route. Move browser code out of the web process. Collect only configured coverage routes and only market families that can intersect Polymarket.

Verification:

- MLB reproduces the visible Winline batch;
- stale/played games are not inserted as upcoming;
- bookmaker label is `Winline`;
- raw capture reference remains available for diagnosis.

### Task 4.3 — Fonbet reconnaissance and connector

**Create:**

- `research/fonbet-network.md`
- `src/connectors/bookmakers/fonbet.js`

Steps:

1. Open only target sport/league pages in Playwright.
2. Inspect bootstrap JSON/XHR/WebSocket traffic.
3. Identify stable event, market and outcome IDs.
4. Document geo/geofence behavior.
5. Implement exact-market extraction for confirmed coverage rules.
6. Add fixture-based parser tests.

### Task 4.4 — Liga Stavok reconnaissance and connector

Same sequence as Fonbet.

**Create:**

- `research/ligastavok-network.md`
- `src/connectors/bookmakers/ligastavok.js`

### Task 4.5 — Keep collectors deployable separately

Dashboard web service stays lightweight on Render. Browser sync can run manually from the existing host first, writing to Postgres. A Render cron/worker can be added later only after connector reliability and explicit schedule approval.

---

## Phase 5 — Polymarket discovery and exact matching

### Task 5.1 — Extend Polymarket connector

**Refactor:** `src/polymarket.js` → `src/connectors/prediction/polymarket.js`

Support:

- active sports market discovery by sport/competition/date;
- event metadata and complete market titles;
- explicit YES and NO token IDs;
- CLOB best bid/ask and depth;
- market fee profile;
- last update/freshness.

### Task 5.2 — Canonical event matcher

**Create:**

- `src/matching/event-matcher.js`
- `src/matching/market-matcher.js`
- `src/matching/team-aliases.js`
- `test/matching.test.js`

Match gates:

1. same sport;
2. same competition/geo where available;
3. exact normalized participants;
4. start time inside sport-specific tolerance;
5. compatible market family and settlement scope;
6. explicit outcome mapping.

Alias mapping is curated and reviewable. No broad string similarity fallback in production.

### Task 5.3 — Strategy-specific hedge selection

**Create:** `src/hedge-strategies.js`

Implement:

- `opposite_yes` for MLB/UFC/tennis and basketball including OT;
- `same_outcome_no` for football 1X2;
- regulation basketball path with explicit draw handling;
- basis-risk flags and strict-arb eligibility.

Add table-driven tests for every sport and outcome.

---

## Phase 6 — Fee-aware arbitrage engine

### Task 6.1 — Generalize the calculator

**Modify:** `src/math.js`
**Create:** `src/fees.js`

Inputs:

- bookmaker decimal odds;
- prediction venue executable price and size;
- prediction venue maker price;
- venue-specific taker/maker fee;
- cash stake and FX;
- hedge strategy;
- settlement/basis-risk eligibility.

Outputs:

- executable hedge cost;
- hedge shares;
- fee;
- payout on bookmaker win;
- payout on prediction-market win;
- locked profit RUB and percentage;
- max executable stake based on order-book depth;
- strict-arbitrage eligibility.

### Task 6.2 — Categorize executable, maker and basis-risk opportunities

- `market`: taker, fee-inclusive, executable at current depth.
- `limit`: maker candidate, no guaranteed fill.

`Top Opportunities` includes fresh positive rows in three visible categories:

```text
Market: net_edge_market > 0 and available_depth >= requested hedge size
Limit: net_edge_limit > 0 (fill is not guaranteed)
Basis risk: positive market or limit edge with basis_risk != NONE
```

Exclude stale quotes. Sort each category by its relevant locked profit descending, then by net percentage. Never present limit or basis-risk rows as guaranteed profit.

### Task 6.3 — Add sport rule tests

Test cases:

- MLB opposite YES;
- UFC two-way without draw;
- tennis retirement-compatible and incompatible cases;
- football Home/Draw/Away each hedged with NO on the same outcome;
- basketball including OT;
- basketball regulation result;
- OT/retirement/draw basis-risk rows included in the labeled risk category;
- positive limit candidate included in the labeled limit category;
- stale quote and insufficient depth excluded.

---

## Phase 7 — API for tabs and filters

### Task 7.1 — Add queryable opportunities endpoint

**Modify:** `server.js`, `src/dashboard.js`

Add:

```text
GET /api/opportunities?sport=football&bookmaker=winline&positive_only=false
GET /api/opportunities?view=top&positive_only=true
POST /api/sync/:venue/:sport   (manual/admin-only development path)
```

Response metadata:

- available sports;
- available bookmakers;
- row/match counts after filters;
- last sync per venue;
- stale/diagnostic counts.

### Task 7.2 — Backward compatibility

Keep `GET /api/data` temporarily while UI migrates. Remove only after server/UI tests use the new endpoint.

### Task 7.3 — Safety and diagnostics

- API must not expose credentials or raw auth headers.
- sync errors are per venue and do not blank the whole dashboard.
- stale rows remain diagnosable but are excluded from Top Opportunities.

---

## Phase 8 — UI tabs and spreadsheet behavior

### Task 8.1 — Two-level navigation

**Modify:**

- `public/index.html`
- `public/styles.css`
- `public/app.js`

Primary tabs:

```text
Top Opportunities | MLB | UFC | Tennis | Football | Basketball
```

Secondary bookmaker tabs/filter:

```text
All books | Winline | Fonbet | Liga Stavok
```

This structure supports future sports and prediction venues from API metadata rather than hardcoded layout duplication.

### Task 8.2 — Preserve compact single-table UI

Keep:

- one global `Cash bet RUB` field;
- one global `RUB per USD` field;
- `Refresh`;
- match and row counts;
- editable bookmaker and prediction prices;
- stable input focus and dot/comma decimals.

Add columns only where useful:

- Sport;
- Book;
- Event / outcome;
- Market scope;
- Book odds;
- Prediction venue/side;
- Market / Limit;
- Hedge / Shares / Fee;
- Locked profit market;
- liquidity/freshness or risk badge.

### Task 8.3 — Top Opportunities behavior

- show positive executable market, limit-order and basis-risk rows;
- merge all supported sports and bookmakers;
- assign a visible category/risk badge and sort descending by relevant locked cash profit;
- clearly label venue, sport, market scope and side;
- never mix limit-only or basis-risk rows into guaranteed market opportunities without a visible category.

### Task 8.4 — Empty and partial states

Tabs with no confirmed intersection display `No exact Polymarket matches`, not seeded/demo rows. A failed bookmaker connector shows a venue-specific warning without hiding healthy venues.

### Task 8.5 — Browser QA

Playwright assertions:

- all tabs render;
- `Winline` is displayed correctly;
- sports and bookmaker filters combine correctly;
- football creates three outcome rows when 1X2 exists;
- top opportunities are positive and descending;
- inputs retain focus and accept `66`, `99`, `.`, `,`, Backspace;
- mobile/desktop table remains usable.

---

## Phase 9 — Kalshi research spike

**Deliverables:**

- `docs/research/kalshi.md`
- `scripts/probes/kalshi-public.js`
- sample normalized fixtures under `test/fixtures/kalshi/`

### Confirmed starting points from official docs

- market discovery: `GET /markets`;
- single book: `GET /markets/{ticker}/orderbook`;
- batch books: `GET /markets/orderbooks`;
- trades: `GET /markets/trades`;
- orderbook returns YES and NO bids only; the opposite-side ask is reconstructed by complement;
- authenticated WebSocket: `wss://external-api-ws.kalshi.com/trade-api/ws/v2`;
- orderbook delta stream requires authenticated WebSocket session;
- series/event fee overrides exist and must be read rather than assuming one global fee.

### Research steps

1. Enumerate open market categories and identify overlaps with current Polymarket sports/non-sports markets.
2. Test which REST market-data endpoints are publicly callable and record rate limits/pagination.
3. Fetch sample orderbooks and reconstruct best YES/NO bid/ask and depth.
4. Verify cents/subpenny fields and rounding behavior.
5. Document current official fee formula, fee type, multiplier, series changes and event overrides.
6. Compare resolution rules and event timing with Polymarket.
7. Produce a connector contract and recommendation: add, defer or add only selected market families.
8. Do not request/store trading credentials during this read-only research phase.

**Research acceptance:** for at least three overlapping candidate markets, produce event IDs/tickers, normalized outcomes, best executable prices, depth, fee model and settlement caveats.

---

## Phase 10 — Predict.fun research spike

**Deliverables:**

- `docs/research/predictfun.md`
- `scripts/probes/predictfun-public.js`
- Playwright network capture notes without credentials;
- sample fixtures under `test/fixtures/predictfun/`.

### Confirmed starting points from official docs

- categories include politics, crypto, sports and other real-world events;
- off-chain CLOB with on-chain BNB Chain settlement;
- makers pay no fee;
- taker fee uses base 2% and `min(price, 1-price) × shares`, with optional 10% discount;
- minimum order value is 1 USDT;
- YES asks are equivalent to NO bids and vice versa;
- multi-outcome markets use a NegRisk-style structure;
- public API/orderbook endpoints are not clearly documented in the public docs and require network reconnaissance.

### Research steps

1. Enumerate visible active markets by category and identify overlaps with Polymarket.
2. Use Playwright to inspect only public market pages and capture XHR/GraphQL/WebSocket endpoints.
3. Identify public market/event IDs, token IDs, orderbook schema, pagination and freshness fields.
4. Determine whether public orderbook fetch requires wallet/auth/session cookies.
5. Validate best bid/ask and depth against visible UI.
6. Verify actual per-market fee parameters instead of assuming the headline base rate.
7. Record BNB Chain contract/token metadata only as a fallback/verification layer, not as the primary live orderbook source.
8. Compare resolution/oracle rules and NegRisk outcome semantics with Polymarket.
9. Produce connector recommendation and risks: API stability, authentication, geofence, settlement, fee discounts and yield effects.

**Research acceptance:** for at least three overlapping candidate markets, return normalized market metadata and a reproducible read-only orderbook fetch, or clearly document the exact blocker.

---

## Phase 11 — Production rollout

### Task 11.1 — Staging verification

Run:

```bash
npm test
node --check server.js
node --check public/app.js
```

Then launch locally and run Playwright QA against the same build.

### Task 11.2 — Deploy to Render

- configure `DATABASE_URL` and other non-secret feature flags;
- run migrations;
- deploy web service;
- run collectors manually for the first population;
- verify `/api/health`, API counts and UI tabs;
- verify the production URL visually and through browser assertions.

### Task 11.3 — Controlled activation

Activation order:

1. Fix Winline label and keep MLB healthy.
2. Add sport tabs with empty honest states.
3. Add exact Winline intersections sport by sport.
4. Add Fonbet.
5. Add Liga Stavok.
6. Enable `Top Opportunities` after fee/depth/staleness tests pass.
7. Evaluate Kalshi/Predict.fun adapters after research review.

No cron schedule changes in this plan.

## Definition of done

- Production displays `Winline`, not source-mode labels.
- Sports tabs exist and are data-driven/extensible.
- Bookmaker tabs exist for Winline, Fonbet and Liga Stavok.
- Football 1X2 uses same-outcome Polymarket NO hedges.
- UFC ignores draw in the core two-way model and surfaces settlement caveats.
- Basketball keeps regulation and including-OT scopes explicit.
- Dashboard renders only confirmed Polymarket intersections.
- Coverage map stores URLs, geographies, competitions, market families, intersection state and recheck metadata.
- `Top Opportunities` contains positive Market, Limit and Basis risk categories; each is labeled and sorted descending.
- Fee, depth and stale-price behavior are tested.
- Runtime state is durable outside the Render filesystem.
- Kalshi and Predict.fun research notes include market coverage, fees, reproducible orderbook access and integration recommendation.

## Main risks and mitigations

| Risk | Mitigation |
|---|---|
| Bookmaker anti-bot/geofence changes | Per-venue connector, raw diagnostic fixtures, browser/manual fallback |
| Similar event names create false matches | Canonical IDs + participant/time/scope gates; no fuzzy auto-approval |
| Settlement mismatch creates fake arb | Store rules/scope/basis risk and place risky rows in a separate visible category |
| Positive price but insufficient depth | Size-aware executable calculation |
| Limit quote shown as guaranteed | Separate executable market and maker candidate views |
| Render filesystem loses overrides/history | Postgres before multi-venue production writes |
| Collector failure blanks dashboard | Last-good quote + stale badge + per-venue diagnostics |
| Predict.fun API is undocumented/unstable | Network-recon spike and fixture contract before adapter work |
| Kalshi fee varies by series/event | Read fee metadata/overrides and test formula per market |
