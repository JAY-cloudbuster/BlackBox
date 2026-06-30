CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  raw_text TEXT NOT NULL,
  source_filename TEXT,
  analysis_latency_ms INTEGER,
  original_file BLOB,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  text TEXT NOT NULL,
  start_index INTEGER NOT NULL,
  end_index INTEGER NOT NULL,
  entity_type TEXT NOT NULL,
  layer TEXT NOT NULL CHECK(layer IN ('critical','ambiguous','visible')),
  confidence_score REAL NOT NULL,
  reasoning TEXT NOT NULL,
  default_action TEXT NOT NULL CHECK(default_action IN ('redact','flag','show')),
  was_calibrated BOOLEAN DEFAULT 0,
  bounding_boxes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS overrides (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id),
  action TEXT NOT NULL CHECK(action IN ('redact','show','reset')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Note: No updated_at or UPDATE statements are used for overrides.
-- This append-only design ensures a true chronological audit trail of all manual human-in-the-loop decisions.

CREATE TABLE IF NOT EXISTS export_log (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  format TEXT NOT NULL,
  exported_at TEXT NOT NULL DEFAULT (datetime('now'))
);
