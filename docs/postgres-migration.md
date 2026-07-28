# Postgres migration

`migrations/001_core.sql` defines the durable multi-venue schema for:

- venues;
- canonical events;
- bookmaker and prediction markets;
- market mappings and basis-risk metadata;
- quote history and depth snapshots;
- manual overrides;
- coverage rules;
- sync-run diagnostics.

`src/storage/postgres-store.js` contains the deterministic transformer from the current `data/store.json` snapshot. Its tests verify that all 24 current Winline MLB markets and mappings survive normalization.

The production process uses `data/store.json` as the source snapshot for seed/manual data and the live connectors for refreshes. When `DATABASE_URL` is configured, the server initializes both migrations on first request and persists dashboard settings, manual row overrides, and source refresh diagnostics in Postgres. If the URL is absent or temporarily unavailable, reads safely fall back to the local store and the API reports the persistence warning in `diagnostics.persistence`.

`GET /api/state`, `POST /api/state/settings`, and `POST /api/state/overrides` expose the durable state contract. The existing `/api/data` response remains backward compatible and includes `settings` and `manual_overrides` in addition to the existing fields. No cron schedule is changed by the migration.
