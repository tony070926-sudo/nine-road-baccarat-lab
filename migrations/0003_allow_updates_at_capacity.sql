-- SQLite runs BEFORE INSERT triggers before resolving an UPSERT conflict.
-- Keep the 100,000-row cap for new identities while allowing an existing
-- identity to update its nickname or self-reported high after the cap is full.
DROP TRIGGER IF EXISTS cap_leaderboard_entries;

CREATE TRIGGER cap_leaderboard_entries
BEFORE INSERT ON leaderboard_entries
WHEN
  (SELECT COUNT(*) FROM leaderboard_entries) >= 100000
  AND NOT EXISTS (
    SELECT 1 FROM leaderboard_entries WHERE player_id = NEW.player_id
  )
BEGIN
  SELECT RAISE(ABORT, 'leaderboard capacity reached');
END;
