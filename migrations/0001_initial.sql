PRAGMA foreign_keys = ON;
CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE oauth_states (state_hash TEXT PRIMARY KEY, verifier TEXT NOT NULL, nonce TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE tasks (
  id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('inbox','todo','doing','done')),
  category TEXT NOT NULL CHECK (category IN ('none','work','personal')),
  pinned INTEGER NOT NULL DEFAULT 0, due TEXT, created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX tasks_user_updated ON tasks(user_id, updated_at);
CREATE TABLE ai_usage (user_id TEXT PRIMARY KEY REFERENCES users(id), day TEXT NOT NULL, count INTEGER NOT NULL);
