CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quick_memos (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  archived_at TEXT,
  converted_type TEXT,
  converted_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS daily_reviews (
  review_date TEXT PRIMARY KEY,
  content TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plan_items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  plan_date TEXT NOT NULL,
  start_time TEXT,
  estimated_minutes INTEGER,
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'todo',
  source_module TEXT,
  source_entity_type TEXT,
  source_entity_id TEXT,
  complete_source INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS media_contents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT '',
  content_format TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL DEFAULT 'idea',
  planned_publish_at TEXT,
  published_at TEXT,
  copy_text TEXT NOT NULL DEFAULT '',
  asset_path TEXT NOT NULL DEFAULT '',
  publish_url TEXT NOT NULL DEFAULT '',
  views INTEGER,
  likes INTEGER,
  comments INTEGER,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS dev_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  local_path TEXT NOT NULL DEFAULT '',
  repository_url TEXT NOT NULL DEFAULT '',
  document_url TEXT NOT NULL DEFAULT '',
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS dev_milestones (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  target_date TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS dev_work_items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
  milestone_id TEXT REFERENCES dev_milestones(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  item_type TEXT NOT NULL DEFAULT 'feature',
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'todo',
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS dev_logs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
  log_date TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS consulting_projects (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  current_need TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS consulting_interactions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES consulting_projects(id) ON DELETE CASCADE,
  occurred_at TEXT NOT NULL,
  interaction_type TEXT NOT NULL DEFAULT 'meeting',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS consulting_deliverables (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES consulting_projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'todo',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS consulting_followups (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES consulting_projects(id) ON DELETE CASCADE,
  followup_at TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo',
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS consulting_time_entries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES consulting_projects(id) ON DELETE CASCADE,
  entry_date TEXT NOT NULL,
  minutes INTEGER NOT NULL DEFAULT 0,
  fee_cents INTEGER,
  settled INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS workout_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  weekday INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS workout_template_exercises (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES workout_templates(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  target_sets INTEGER NOT NULL DEFAULT 3,
  target_reps INTEGER,
  target_weight REAL,
  rest_seconds INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS workouts (
  id TEXT PRIMARY KEY,
  template_id TEXT REFERENCES workout_templates(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  workout_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  feeling TEXT NOT NULL DEFAULT '',
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS workout_exercises (
  id TEXT PRIMARY KEY,
  workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS workout_sets (
  id TEXT PRIMARY KEY,
  workout_exercise_id TEXT NOT NULL REFERENCES workout_exercises(id) ON DELETE CASCADE,
  set_number INTEGER NOT NULL,
  reps INTEGER,
  weight REAL,
  completed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS body_metrics (
  id TEXT PRIMARY KEY,
  metric_date TEXT NOT NULL,
  weight REAL,
  waist REAL,
  chest REAL,
  body_fat REAL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS nutrition_targets (
  id TEXT PRIMARY KEY,
  effective_date TEXT NOT NULL,
  calories REAL,
  protein REAL,
  carbs REAL,
  fat REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS foods (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  default_portion REAL,
  portion_unit TEXT NOT NULL DEFAULT '份',
  calories REAL,
  protein REAL,
  carbs REAL,
  fat REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS meals (
  id TEXT PRIMARY KEY,
  meal_date TEXT NOT NULL,
  meal_type TEXT NOT NULL,
  name TEXT NOT NULL,
  entry_kind TEXT NOT NULL DEFAULT 'planned',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS meal_items (
  id TEXT PRIMARY KEY,
  meal_id TEXT NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  food_id TEXT REFERENCES foods(id) ON DELETE SET NULL,
  food_name TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  calories REAL,
  protein REAL,
  carbs REAL,
  fat REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS entertainment_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT '',
  activity_type TEXT NOT NULL DEFAULT 'game',
  status TEXT NOT NULL DEFAULT 'wishlist',
  progress TEXT NOT NULL DEFAULT '',
  next_goal TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  rating REAL,
  completed_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS play_sessions (
  id TEXT PRIMARY KEY,
  entertainment_id TEXT NOT NULL REFERENCES entertainment_items(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_minutes INTEGER,
  progress_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS trash_entries (
  id TEXT PRIMARY KEY,
  collection TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  display_title TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  UNIQUE(collection, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_plan_items_date_status ON plan_items(plan_date, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_plan_items_source ON plan_items(source_module, source_entity_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_media_stage_publish ON media_contents(stage, planned_publish_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dev_items_project_status ON dev_work_items(project_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_consulting_followups_date ON consulting_followups(followup_at, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_workouts_date ON workouts(workout_date, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_meals_date_kind ON meals(meal_date, entry_kind) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_entertainment ON play_sessions(entertainment_id, started_at) WHERE deleted_at IS NULL;
