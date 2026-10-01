CREATE TABLE IF NOT EXISTS app_records (
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (table_name, record_id)
);
CREATE INDEX IF NOT EXISTS idx_app_records_table ON app_records(table_name);