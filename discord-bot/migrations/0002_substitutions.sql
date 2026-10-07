-- Who replaced whom during a tournament (/player swap). Results the old
-- player already earned carry forward to the replacement, so later matches
-- are filled in with the new player.
CREATE TABLE substitutions (
  tournament_id INTEGER NOT NULL REFERENCES tournaments (id),
  old_player_id INTEGER NOT NULL REFERENCES players (id),
  new_player_id INTEGER NOT NULL REFERENCES players (id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tournament_id, old_player_id)
);
