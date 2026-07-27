BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS venues (
  venue_key text PRIMARY KEY,
  label text NOT NULL,
  venue_type text NOT NULL CHECK (venue_type IN ('bookmaker', 'prediction')),
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO venues (venue_key, label, venue_type) VALUES
  ('winline', 'Winline', 'bookmaker'),
  ('fonbet', 'Fonbet', 'bookmaker'),
  ('ligastavok', 'Liga Stavok', 'bookmaker'),
  ('polymarket', 'Polymarket', 'prediction'),
  ('kalshi', 'Kalshi', 'prediction'),
  ('predictfun', 'Predict.fun', 'prediction')
ON CONFLICT (venue_key) DO UPDATE SET label = EXCLUDED.label, venue_type = EXCLUDED.venue_type;

CREATE TABLE IF NOT EXISTS canonical_events (
  event_key text PRIMARY KEY,
  sport text NOT NULL,
  geo text,
  competition text,
  title text NOT NULL,
  participants jsonb NOT NULL DEFAULT '[]'::jsonb,
  start_at timestamptz,
  status text NOT NULL DEFAULT 'upcoming',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bookmaker_markets (
  bookmaker_market_id text PRIMARY KEY,
  bookmaker_key text NOT NULL REFERENCES venues(venue_key),
  event_key text REFERENCES canonical_events(event_key),
  input_id text,
  sport text NOT NULL,
  event_title text NOT NULL,
  event_start_at timestamptz,
  market_type text,
  market_family text,
  settlement_scope text,
  outcome_key text,
  outcome_label text NOT NULL,
  captured_decimal_odds numeric,
  edited_decimal_odds numeric,
  effective_decimal_odds numeric,
  source_mode text,
  source_ref text,
  raw_payload jsonb,
  normalized_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prediction_markets (
  prediction_venue text NOT NULL REFERENCES venues(venue_key),
  external_market_id text NOT NULL,
  event_key text REFERENCES canonical_events(event_key),
  question text,
  market_family text,
  settlement_scope text,
  token_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  rules text,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (prediction_venue, external_market_id)
);

CREATE TABLE IF NOT EXISTS market_mappings (
  pair_id text PRIMARY KEY,
  bookmaker_market_id text NOT NULL REFERENCES bookmaker_markets(bookmaker_market_id),
  bookmaker_key text NOT NULL REFERENCES venues(venue_key),
  prediction_venue text NOT NULL REFERENCES venues(venue_key),
  poly_market_id text NOT NULL,
  poly_outcome_index integer,
  sport text NOT NULL,
  market_family text NOT NULL,
  settlement_scope text NOT NULL,
  hedge_strategy text NOT NULL,
  basis_risk text NOT NULL DEFAULT 'NONE',
  pairing_mode text,
  mapping_confidence numeric,
  mapping_status text NOT NULL,
  settlement_caveat text,
  poly_no_market_override numeric,
  poly_no_limit_override numeric,
  poly_no_easy_override numeric,
  created_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quotes (
  quote_id bigserial PRIMARY KEY,
  venue text NOT NULL REFERENCES venues(venue_key),
  market_ref text NOT NULL,
  outcome_ref text,
  quote_type text NOT NULL,
  price numeric,
  size numeric,
  captured_at timestamptz NOT NULL,
  raw_payload jsonb,
  UNIQUE (venue, market_ref, outcome_ref, quote_type, captured_at)
);

CREATE INDEX IF NOT EXISTS quotes_latest_idx ON quotes (venue, market_ref, captured_at DESC);

CREATE TABLE IF NOT EXISTS manual_overrides (
  override_id bigserial PRIMARY KEY,
  target_type text NOT NULL,
  target_id text NOT NULL,
  field_name text NOT NULL,
  value jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (target_type, target_id, field_name)
);

CREATE TABLE IF NOT EXISTS coverage_rules (
  coverage_id bigserial PRIMARY KEY,
  venue text NOT NULL REFERENCES venues(venue_key),
  sport text NOT NULL,
  geo text NOT NULL,
  competition text NOT NULL,
  market_family text NOT NULL,
  settlement_scope text NOT NULL,
  source_path text,
  intersection_status text NOT NULL,
  last_checked_at timestamptz,
  last_matched_at timestamptz,
  recheck_policy text,
  notes text,
  UNIQUE (venue, sport, geo, competition, market_family, settlement_scope)
);

CREATE TABLE IF NOT EXISTS sync_runs (
  sync_run_id bigserial PRIMARY KEY,
  venue text NOT NULL REFERENCES venues(venue_key),
  sport text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL,
  scanned_count integer NOT NULL DEFAULT 0,
  matched_count integer NOT NULL DEFAULT 0,
  rejected_count integer NOT NULL DEFAULT 0,
  stale_count integer NOT NULL DEFAULT 0,
  diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb
);

INSERT INTO schema_migrations (name) VALUES ('001_core.sql') ON CONFLICT DO NOTHING;
COMMIT;
