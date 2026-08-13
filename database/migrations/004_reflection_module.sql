CREATE TABLE IF NOT EXISTS daily_reflections (
  id TEXT PRIMARY KEY,
  reflection_date TEXT NOT NULL,
  source_category TEXT NOT NULL DEFAULT 'other',
  source_detail TEXT NOT NULL DEFAULT '',
  work_summary TEXT NOT NULL DEFAULT '',
  life_summary TEXT NOT NULL DEFAULT '',
  gains TEXT NOT NULL DEFAULT '',
  problems TEXT NOT NULL DEFAULT '',
  improvements TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_reflections_active_date ON daily_reflections(reflection_date) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS reflection_actions (
  id TEXT PRIMARY KEY,
  reflection_id TEXT NOT NULL REFERENCES daily_reflections(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  plan_item_id TEXT REFERENCES plan_items(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_reflection_actions_parent ON reflection_actions(reflection_id, sort_order) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS thought_notes (
  id TEXT PRIMARY KEY,
  note_date TEXT NOT NULL,
  title TEXT NOT NULL,
  source_category TEXT NOT NULL,
  source_detail TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_thought_notes_date ON thought_notes(note_date, updated_at) WHERE deleted_at IS NULL;
