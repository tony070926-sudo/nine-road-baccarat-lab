-- Public scores are client-reported simulation highs, not server-verified game results.
CREATE TABLE IF NOT EXISTS leaderboard_entries (
  player_id TEXT PRIMARY KEY NOT NULL
    CHECK (
      length(player_id) = 36
      AND player_id = lower(player_id)
      AND substr(player_id, 9, 1) = '-'
      AND substr(player_id, 14, 1) = '-'
      AND substr(player_id, 19, 1) = '-'
      AND substr(player_id, 24, 1) = '-'
      AND substr(player_id, 15, 1) IN ('1', '2', '3', '4', '5', '6', '7', '8')
      AND substr(player_id, 20, 1) IN ('8', '9', 'a', 'b')
      AND player_id NOT GLOB '*[^0-9a-f-]*'
    ),
  display_name TEXT NOT NULL
    CHECK (
      display_name = trim(display_name)
      AND length(display_name) BETWEEN 2 AND 16
    ),
  highest_balance_x2 INTEGER NOT NULL
    CHECK (highest_balance_x2 BETWEEN 20000 AND 2000000000),
  token_hash TEXT NOT NULL
    CHECK (
      length(token_hash) = 64
      AND token_hash NOT GLOB '*[^0-9a-f]*'
    ),
  achieved_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_leaderboard_ranking
  ON leaderboard_entries (
    highest_balance_x2 DESC,
    achieved_at ASC,
    player_id ASC
  );
