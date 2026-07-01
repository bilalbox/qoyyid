CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  pdf_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploaded',
  title TEXT,
  total_pages INTEGER NOT NULL DEFAULT 0,
  ocr_count INTEGER NOT NULL DEFAULT 0,
  ocr_done INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ocr_tasks (
  job_id TEXT NOT NULL,
  page_index INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  png_key TEXT,
  pdf_key TEXT,
  needs_rasterize INTEGER NOT NULL DEFAULT 0,
  result_key TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  worker_id TEXT,
  leased_until TEXT,
  PRIMARY KEY (job_id, page_index),
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_ocr_tasks_claim
  ON ocr_tasks (status, leased_until);

CREATE INDEX IF NOT EXISTS idx_jobs_sha256 ON jobs (sha256);
