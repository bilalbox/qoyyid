-- Auth (pattern from parse: arctic + D1 sessions + invite-gating), plus is_admin
-- and quota columns (unit-based, manual top-up per project decision).
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  quota_pages_limit INTEGER NOT NULL DEFAULT 0,
  quota_pages_used INTEGER NOT NULL DEFAULT 0,
  quota_minutes_limit INTEGER NOT NULL DEFAULT 0,
  quota_minutes_used INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);

CREATE TABLE invites (
  email TEXT PRIMARY KEY,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  used_at DATETIME,
  used_by TEXT REFERENCES users(id)
);

-- Drop GPU-dispatch-era tables entirely; no production data to preserve.
DROP TABLE IF EXISTS ocr_tasks;
DROP TABLE IF EXISTS jobs;

-- Reshaped jobs table for the Mistral batch OCR lifecycle (whole-document
-- requests, not per-page dispatch).
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  sha256 TEXT NOT NULL,
  pdf_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploaded',
  title TEXT,
  total_pages INTEGER NOT NULL DEFAULT 0,
  mistral_file_id TEXT,
  mistral_batch_job_id TEXT,
  mistral_pages_processed INTEGER,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_jobs_sha256 ON jobs (sha256);
CREATE INDEX idx_jobs_user_id ON jobs (user_id);
CREATE INDEX idx_jobs_status ON jobs (status);

-- Usage ledger. kind already includes asr_minutes for the future ASR
-- fast-follow, so no migration rework is needed when Voxtral ships.
CREATE TABLE usage_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  job_id TEXT REFERENCES jobs(id),
  kind TEXT NOT NULL CHECK (kind IN ('ocr_pages', 'asr_minutes')),
  quantity INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_usage_events_user_id ON usage_events(user_id);
CREATE INDEX idx_usage_events_job_id ON usage_events(job_id);
