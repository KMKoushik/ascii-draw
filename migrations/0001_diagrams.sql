CREATE TABLE diagrams (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  spec TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT
);
