CREATE TABLE IF NOT EXISTS workspace_schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_entities (
  collection text NOT NULL,
  id text NOT NULL,
  payload JSONB NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  PRIMARY KEY (collection, id),
  CHECK (
    jsonb_typeof(payload) = 'object'
    AND payload ? 'id'
    AND jsonb_typeof(payload->'id') = 'string'
    AND payload->>'id' = id
  )
);

CREATE TABLE IF NOT EXISTS workspace_settings (
  key text PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_daily_reviews (
  review_date date PRIMARY KEY,
  payload JSONB NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_blob_cleanup (
  pathname text PRIMARY KEY,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_entities_active
  ON workspace_entities (collection, created_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_workspace_entities_updated
  ON workspace_entities (updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_active_focus_timer
  ON workspace_entities (collection)
  WHERE collection = 'focusTimers'
    AND deleted_at IS NULL
    AND payload->>'status' IN ('running', 'paused');

CREATE INDEX IF NOT EXISTS idx_workspace_blob_cleanup_due
  ON workspace_blob_cleanup (next_attempt_at, created_at);

INSERT INTO workspace_schema_migrations (version)
VALUES ('001_workspace')
ON CONFLICT (version) DO NOTHING;
