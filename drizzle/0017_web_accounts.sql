-- Native website accounts are independent from external products and WeChat.
CREATE TABLE IF NOT EXISTS coach_web_users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL,
  username_norm TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 100000 CHECK(password_iterations = 100000),
  created_at INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS coach_web_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES coach_web_users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coach_web_sessions_user ON coach_web_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_coach_web_sessions_expiry ON coach_web_sessions(expires_at);
CREATE TABLE IF NOT EXISTS coach_web_auth_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coach_web_auth_expiry ON coach_web_auth_attempts(expires_at);
