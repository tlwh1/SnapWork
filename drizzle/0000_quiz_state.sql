CREATE TABLE IF NOT EXISTS quiz_state (
  user_id TEXT PRIMARY KEY NOT NULL,
  progress_json TEXT NOT NULL DEFAULT '{}',
  session_json TEXT,
  updated_at INTEGER NOT NULL
);

