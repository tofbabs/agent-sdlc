CREATE TABLE reports (
  run_id      TEXT    NOT NULL,
  sessions    INTEGER NOT NULL,
  repo_id     TEXT    NOT NULL,
  token_hash  TEXT    NOT NULL,
  received_at TEXT    NOT NULL,
  schema      INTEGER NOT NULL,
  body        TEXT    NOT NULL,
  PRIMARY KEY (run_id, sessions)
);
CREATE INDEX reports_repo_id ON reports (repo_id);
CREATE INDEX reports_received_at ON reports (received_at);

CREATE TABLE tokens (
  token_hash     TEXT PRIMARY KEY,
  repo_id        TEXT    NOT NULL,
  created_at     TEXT    NOT NULL,
  accepted_total INTEGER NOT NULL DEFAULT 0,
  last_seen_at   TEXT
);
CREATE INDEX tokens_repo_id ON tokens (repo_id);

CREATE TABLE counters (
  key  TEXT    NOT NULL,
  day  TEXT    NOT NULL,
  n    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, day)
);
