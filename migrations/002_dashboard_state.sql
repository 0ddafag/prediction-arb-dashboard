BEGIN;

CREATE TABLE IF NOT EXISTS dashboard_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS opportunities (
  row_id text PRIMARY KEY,
  bookmaker_key text NOT NULL,
  provider_event_id text,
  event_name text,
  sport text,
  league text,
  market_key text,
  poly_market_id text,
  poly_slug text,
  poly_outcome text,
  status text NOT NULL DEFAULT 'confirmed',
  basis_risk text,
  raw jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS source_snapshots (
  id bigserial PRIMARY KEY,
  source text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  summary jsonb,
  raw jsonb
);

CREATE INDEX IF NOT EXISTS source_snapshots_source_captured_idx
  ON source_snapshots (source, captured_at DESC);

INSERT INTO schema_migrations (name) VALUES ('002_dashboard_state.sql') ON CONFLICT DO NOTHING;
COMMIT;