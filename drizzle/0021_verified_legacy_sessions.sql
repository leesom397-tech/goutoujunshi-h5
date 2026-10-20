-- Keep existing lovetalk owners while moving verified browser sessions to D1.
-- No credentials, raw session tokens, credits, or duplicate user records are stored.
CREATE TABLE IF NOT EXISTS coach_web_legacy_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL CHECK(owner_id LIKE 'lovetalk:%'),
  display_name TEXT NOT NULL,
  source_cookie_hash TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coach_web_legacy_sessions_owner ON coach_web_legacy_sessions(owner_id);
CREATE INDEX IF NOT EXISTS idx_coach_web_legacy_sessions_expiry ON coach_web_legacy_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_coach_web_legacy_sessions_source ON coach_web_legacy_sessions(source_cookie_hash);
-- Retain source revocations even after the local session deadline. The old
-- provider's maximum token lifetime has not been established.
CREATE TABLE IF NOT EXISTS coach_web_legacy_revocations (
  source_cookie_hash TEXT PRIMARY KEY NOT NULL,
  expires_at INTEGER NOT NULL
);
