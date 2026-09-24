CREATE TABLE IF NOT EXISTS users (
  telegram_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS records (
  id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  record_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, record_type, id),
  FOREIGN KEY (owner_id) REFERENCES users(telegram_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS records_owner_type_updated_idx
  ON records(owner_id, record_type, updated_at DESC);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  record_type TEXT NOT NULL,
  record_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users(telegram_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS attachments_record_idx
  ON attachments(owner_id, record_type, record_id, created_at DESC);
