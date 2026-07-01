-- Web push device tokens for job-completion notifications. Tokens go stale
-- when a browser revokes permission or clears storage; the send path deletes
-- rows on FCM's UNREGISTERED/NOT_FOUND response rather than leaving them to
-- fail silently forever.
CREATE TABLE fcm_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_fcm_tokens_user_id ON fcm_tokens (user_id);
