# Neon Winline Pipeline Implementation Plan

> **workflow_level:** feature

**Goal:** Make the production dashboard consume one Neon-backed Winline snapshot path while keeping `/api/data` backward compatible.

**Architecture:** A local/VPS Playwright collector is the only browser scraper and upserts `live_source_snapshots` in Neon. Render reads the latest snapshot, exact-matches it with Polymarket, applies durable manual overrides, and returns the existing dashboard payload. Missing, stale, or error snapshots produce an honest unavailable state with no seed/live resurrection.

**Scope:** backend storage/migrations, Winline collector, exact stable row IDs, dashboard source selection, Refresh semantics, and tests. No deployment, credentials, fuzzy matching, or new bookmaker adapters.

---

### Task 1: Add canonical Neon schema and storage helpers
- Create migration for `live_source_snapshots`, canonical `manual_overrides`, settings compatibility, and indexes.
- Add latest snapshot read/upsert with status/error and stale policy.
- Keep no-`DATABASE_URL` state safe and explicit.

### Task 2: Move Winline ingestion to external collector
- Make the collector the only Playwright path and write `source='winline'` snapshots.
- Persist error snapshots without replacing the last successful snapshot.
- Remove file/GitHub fallback from the backend Winline loader.

### Task 3: Use Neon Winline snapshot in `/api/data`
- Stop Render from invoking Winline/Fonbet Playwright paths.
- Build live rows only from a fresh successful Neon snapshot and exact Polymarket matches.
- Preserve the existing response shape and expose stale/error diagnostics.

### Task 4: Stabilize row IDs and override application
- Derive row IDs from bookmaker, provider event, factor/market, Polymarket market, and outcome.
- Store/reload overrides by canonical row ID without live refresh overwriting them.

### Task 5: Narrow UI and verify
- Remove the server-browser Winline update control; Refresh only reloads `/api/refresh`.
- Add regression tests for stale/error/missing paths, stable IDs, DB override SQL contract, and UI semantics.
- Run the full Node test suite and a no-DB HTTP smoke test; report Neon credential blockers honestly.
