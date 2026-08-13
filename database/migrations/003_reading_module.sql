CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'wishlist',
  total_pages INTEGER,
  current_page INTEGER NOT NULL DEFAULT 0,
  rating REAL,
  description TEXT NOT NULL DEFAULT '',
  cover_file_id TEXT,
  cover_filename TEXT,
  pdf_file_id TEXT,
  pdf_filename TEXT,
  last_read_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK (current_page >= 0),
  CHECK (total_pages IS NULL OR total_pages > 0),
  CHECK (total_pages IS NULL OR current_page <= total_pages),
  CHECK (rating IS NULL OR (rating >= 0 AND rating <= 10))
);

CREATE TABLE IF NOT EXISTS reading_sessions (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  session_date TEXT NOT NULL,
  start_page INTEGER NOT NULL,
  end_page INTEGER NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK (start_page >= 0),
  CHECK (end_page >= start_page),
  CHECK (duration_minutes >= 0)
);

CREATE TABLE IF NOT EXISTS reading_notes (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  note_date TEXT NOT NULL,
  chapter TEXT NOT NULL DEFAULT '',
  start_page INTEGER,
  end_page INTEGER,
  excerpt TEXT NOT NULL DEFAULT '',
  feeling TEXT NOT NULL DEFAULT '',
  thinking TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK (start_page IS NULL OR start_page >= 0),
  CHECK (end_page IS NULL OR end_page >= COALESCE(start_page, 0))
);

CREATE INDEX IF NOT EXISTS idx_books_status ON books(status, updated_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_reading_sessions_book_date ON reading_sessions(book_id, session_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_reading_notes_book_date ON reading_notes(book_id, note_date) WHERE deleted_at IS NULL;
