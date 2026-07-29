BEGIN;

-- Canonical production snapshot: one current row per source, never a history table.
CREATE TABLE IF NOT EXISTS live_source_snapshots (
  source text PRIMARY KEY,
  captured_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('ok', 'error')),
  error text,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Replace the previous field-per-row state table with one durable override document.
-- Do not rename again when a previous run already left the legacy table behind.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'manual_overrides' AND column_name = 'target_id'
  ) AND to_regclass('public.manual_overrides_legacy') IS NULL THEN
    ALTER TABLE manual_overrides RENAME TO manual_overrides_legacy;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS manual_overrides (
  row_id text PRIMARY KEY,
  bookmaker_key text,
  provider_event_id text,
  market_key text,
  poly_market_id text,
  poly_outcome text,
  override jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS manual_overrides_market_idx
  ON manual_overrides (bookmaker_key, provider_event_id, poly_market_id);

DO $$
DECLARE
  legacy_has_target_type boolean;
  legacy_has_target_id boolean;
  legacy_has_field_name boolean;
  legacy_has_value boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'manual_overrides_legacy' AND column_name = 'target_type'
  ) INTO legacy_has_target_type;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'manual_overrides_legacy' AND column_name = 'target_id'
  ) INTO legacy_has_target_id;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'manual_overrides_legacy' AND column_name = 'field_name'
  ) INTO legacy_has_field_name;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'manual_overrides_legacy' AND column_name = 'value'
  ) INTO legacy_has_value;

  -- A failed/partial legacy table may have lost target_type. Preserve its
  -- field values without making the whole Neon initialization fail.
  IF to_regclass('public.manual_overrides_legacy') IS NOT NULL
    AND legacy_has_target_id AND legacy_has_field_name AND legacy_has_value THEN
    IF legacy_has_target_type THEN
      EXECUTE $migration$
        INSERT INTO manual_overrides (row_id, market_key, override)
        SELECT target_id, max(target_type), jsonb_object_agg(field_name, value)
        FROM manual_overrides_legacy
        GROUP BY target_id
        ON CONFLICT (row_id) DO NOTHING
      $migration$;
    ELSE
      EXECUTE $migration$
        INSERT INTO manual_overrides (row_id, market_key, override)
        SELECT target_id, NULL::text, jsonb_object_agg(field_name, value)
        FROM manual_overrides_legacy
        GROUP BY target_id
        ON CONFLICT (row_id) DO NOTHING
      $migration$;
    END IF;
  END IF;
END $$;

INSERT INTO schema_migrations (name) VALUES ('003_neon_winline_pipeline.sql') ON CONFLICT DO NOTHING;
COMMIT;
