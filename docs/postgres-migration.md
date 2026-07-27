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

The production process still uses `data/store.json` until a real `DATABASE_URL` is provisioned. Applying the migration or wiring writes without credentials would create fake durability, so this step is intentionally gated on a reachable Postgres instance. No cron schedule is changed by the migration.
