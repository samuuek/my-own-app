ALTER TABLE plan_items ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY plan_date
    ORDER BY COALESCE(start_time, '99:99'), created_at
  ) - 1 AS position
  FROM plan_items
)
UPDATE plan_items
SET sort_order = (SELECT position FROM ranked WHERE ranked.id = plan_items.id);

CREATE TABLE IF NOT EXISTS important_dates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  target_date TEXT NOT NULL,
  recurrence TEXT NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none', 'yearly')),
  color TEXT NOT NULL DEFAULT 'blue' CHECK (color IN ('blue', 'green', 'orange', 'red')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS long_term_goals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  target_date TEXT,
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS focus_timers (
  id TEXT PRIMARY KEY,
  plan_item_id TEXT REFERENCES plan_items(id) ON DELETE SET NULL,
  planned_minutes INTEGER NOT NULL CHECK (planned_minutes > 0),
  started_at TEXT NOT NULL,
  paused_at TEXT,
  paused_seconds INTEGER NOT NULL DEFAULT 0 CHECK (paused_seconds >= 0),
  ended_at TEXT,
  actual_seconds INTEGER,
  status TEXT NOT NULL CHECK (status IN ('running', 'paused', 'completed', 'cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_important_dates_sort
  ON important_dates(sort_order, target_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_long_term_goals_status_sort
  ON long_term_goals(status, sort_order) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_plan_items_date_sort
  ON plan_items(plan_date, sort_order, start_time) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_focus_timers_one_active
  ON focus_timers((1)) WHERE deleted_at IS NULL AND status IN ('running', 'paused');

INSERT INTO settings(key, value, updated_at) VALUES
  ('appearance', '"ios"', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;

INSERT INTO settings(key, value, updated_at) VALUES
  ('ios_progress_workbench_migrated_v1', 'true', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT(key) DO NOTHING;
