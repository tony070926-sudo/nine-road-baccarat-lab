-- Enforce the per-identity two-second write interval atomically in D1. The
-- previous updated_at precheck remains useful metadata but cannot serialize
-- concurrent requests on its own.
CREATE TABLE IF NOT EXISTS leaderboard_identity_limits (
  token_hash TEXT PRIMARY KEY NOT NULL
    CHECK (
      length(token_hash) = 64
      AND token_hash NOT GLOB '*[^0-9a-f]*'
    ),
  last_changed_at INTEGER NOT NULL CHECK (last_changed_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= last_changed_at)
) STRICT, WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_leaderboard_identity_limits_updated
  ON leaderboard_identity_limits (updated_at);

CREATE TRIGGER IF NOT EXISTS prune_expired_leaderboard_identity_limits
AFTER INSERT ON leaderboard_identity_limits
BEGIN
  DELETE FROM leaderboard_identity_limits
  WHERE updated_at < NEW.updated_at - 86400000;
END;

CREATE TRIGGER IF NOT EXISTS prune_expired_leaderboard_identity_limits_after_update
AFTER UPDATE ON leaderboard_identity_limits
BEGIN
  DELETE FROM leaderboard_identity_limits
  WHERE updated_at < NEW.updated_at - 86400000;
END;
