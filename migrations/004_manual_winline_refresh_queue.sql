BEGIN;

CREATE TABLE IF NOT EXISTS winline_refresh_requests (
  id bigserial PRIMARY KEY,
  requested_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
  started_at timestamptz,
  finished_at timestamptz,
  worker_id text,
  error text,
  result jsonb,
  request_source text NOT NULL DEFAULT 'dashboard'
);

CREATE INDEX IF NOT EXISTS winline_refresh_requests_latest_idx ON winline_refresh_requests (requested_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS winline_refresh_requests_one_active_idx
  ON winline_refresh_requests ((true)) WHERE status IN ('pending', 'running');

INSERT INTO schema_migrations (name) VALUES ('004_manual_winline_refresh_queue.sql') ON CONFLICT DO NOTHING;
COMMIT;