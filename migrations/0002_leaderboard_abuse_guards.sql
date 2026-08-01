-- Bound an intentionally unverified public simulation leaderboard. The
-- Function HMACs the connecting network address; no raw address is stored.
CREATE TRIGGER IF NOT EXISTS cap_leaderboard_entries
BEFORE INSERT ON leaderboard_entries
WHEN (SELECT COUNT(*) FROM leaderboard_entries) >= 100000
BEGIN
  SELECT RAISE(ABORT, 'leaderboard capacity reached');
END;

CREATE TABLE IF NOT EXISTS leaderboard_rate_limits (
  network_hash TEXT NOT NULL
    CHECK (
      length(network_hash) = 64
      AND network_hash NOT GLOB '*[^0-9a-f]*'
    ),
  bucket TEXT NOT NULL
    CHECK (bucket IN ('new-identities', 'submissions')),
  window_started_at INTEGER NOT NULL CHECK (window_started_at >= 0),
  request_count INTEGER NOT NULL CHECK (request_count >= 1),
  updated_at INTEGER NOT NULL CHECK (updated_at >= window_started_at),
  PRIMARY KEY (network_hash, bucket)
) STRICT, WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_leaderboard_rate_limits_updated
  ON leaderboard_rate_limits (updated_at);

CREATE TRIGGER IF NOT EXISTS prune_expired_leaderboard_rate_limits
AFTER INSERT ON leaderboard_rate_limits
BEGIN
  DELETE FROM leaderboard_rate_limits
  WHERE updated_at < NEW.updated_at - 86400000;
END;

CREATE TRIGGER IF NOT EXISTS prune_expired_leaderboard_rate_limits_after_update
AFTER UPDATE ON leaderboard_rate_limits
BEGIN
  DELETE FROM leaderboard_rate_limits
  WHERE updated_at < NEW.updated_at - 86400000;
END;
