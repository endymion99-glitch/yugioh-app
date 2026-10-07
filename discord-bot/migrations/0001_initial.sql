-- Initial schema for the tournament bot.
-- Apply with: npx wrangler d1 migrations apply yugioh-tournament --remote

-- Bot settings set with /config: admin_role_id, channel_id.
CREATE TABLE config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Best-of format per bracket stage. Copied onto each match when it is
-- created, so editing this only affects matches created afterwards.
--   R1 = Round 1, WS = Winners' semis, LS = Losers' semis,
--   P1 = 1st/2nd (final), P3 = 3rd/4th, P5 = 5th/6th, P7 = 7th/8th
CREATE TABLE stage_formats (
  stage   TEXT PRIMARY KEY CHECK (stage IN ('R1', 'WS', 'LS', 'P1', 'P3', 'P5', 'P7')),
  best_of INTEGER NOT NULL CHECK (best_of IN (1, 3))
);

-- Players are never deleted, only deactivated, so their history stays.
CREATE TABLE players (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
-- A Discord user can be linked to at most one active player.
CREATE UNIQUE INDEX players_active_discord ON players (discord_user_id) WHERE active = 1;

-- status: in_progress -> finished. A finished tournament whose correction
-- cleared later matches goes to 'correcting' until an admin re-enters them.
CREATE TABLE tournaments (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  number             INTEGER NOT NULL UNIQUE,
  status             TEXT NOT NULL DEFAULT 'in_progress'
                       CHECK (status IN ('in_progress', 'finished', 'correcting')),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at        TEXT,
  summary_message_id TEXT
);
-- At most one tournament is being played at a time.
CREATE UNIQUE INDEX tournaments_one_in_progress ON tournaments (status) WHERE status = 'in_progress';

-- One row per match; 12 per tournament.
--   slot: M1-M4 (Round 1), WA/WB (Winners' semis), LA/LB (Losers' semis),
--         P1/P3/P5/P7 (placement matches for 1st, 3rd, 5th, 7th place)
--   status: waiting   = players not known yet (feeder matches unfinished)
--           ready     = both players known, can be played
--           pending   = a player reported; waiting for the opponent to confirm
--           disputed  = the opponent disputed; an admin must decide
--           confirmed = final result
-- While pending/disputed, winner_id and the scores hold the claimed result.
CREATE TABLE matches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments (id),
  stage         TEXT NOT NULL CHECK (stage IN ('R1', 'WS', 'LS', 'P1', 'P3', 'P5', 'P7')),
  slot          TEXT NOT NULL CHECK (slot IN ('M1', 'M2', 'M3', 'M4', 'WA', 'WB', 'LA', 'LB', 'P1', 'P3', 'P5', 'P7')),
  best_of       INTEGER NOT NULL CHECK (best_of IN (1, 3)),
  player1_id    INTEGER REFERENCES players (id),
  player2_id    INTEGER REFERENCES players (id),
  winner_id     INTEGER REFERENCES players (id),
  score_p1      INTEGER CHECK (score_p1 >= 0),
  score_p2      INTEGER CHECK (score_p2 >= 0),
  status        TEXT NOT NULL DEFAULT 'waiting'
                  CHECK (status IN ('waiting', 'ready', 'pending', 'disputed', 'confirmed')),
  feeder_a      TEXT,
  feeder_b      TEXT,
  reported_by   INTEGER REFERENCES players (id),
  confirmed_at  TEXT,
  message_id    TEXT,
  announced_at  TEXT,
  UNIQUE (tournament_id, slot),
  CHECK (winner_id IS NULL OR winner_id = player1_id OR winner_id = player2_id),
  CHECK (player1_id IS NULL OR player2_id IS NULL OR player1_id <> player2_id)
);

-- Final places of finished tournaments. Points are not stored here: they
-- are looked up in points_table, so editing that table updates every
-- tournament's points and everyone's totals.
CREATE TABLE placements (
  tournament_id INTEGER NOT NULL REFERENCES tournaments (id),
  player_id     INTEGER NOT NULL REFERENCES players (id),
  place         INTEGER NOT NULL CHECK (place BETWEEN 1 AND 8),
  PRIMARY KEY (tournament_id, place),
  UNIQUE (tournament_id, player_id)
);

CREATE TABLE points_table (
  place  INTEGER PRIMARY KEY CHECK (place BETWEEN 1 AND 8),
  points INTEGER NOT NULL
);

CREATE TABLE rewards_table (
  place        INTEGER PRIMARY KEY CHECK (place BETWEEN 1 AND 8),
  base_packs   INTEGER NOT NULL DEFAULT 0 CHECK (base_packs >= 0),
  extra_packs  INTEGER NOT NULL DEFAULT 0 CHECK (extra_packs >= 0),
  chosen_cards INTEGER NOT NULL DEFAULT 0 CHECK (chosen_cards >= 0)
);

-- Defaults from the spec. Admins can change these with commands later.
INSERT INTO stage_formats (stage, best_of) VALUES
  ('R1', 1), ('WS', 1), ('LS', 1), ('P1', 3), ('P3', 1), ('P5', 1), ('P7', 1);

INSERT INTO points_table (place, points) VALUES
  (1, 10), (2, 8), (3, 7), (4, 6), (5, 5), (6, 4), (7, 3), (8, 1);

INSERT INTO rewards_table (place, base_packs, extra_packs, chosen_cards) VALUES
  (1, 10, 0, 4),
  (2, 10, 0, 3),
  (3, 10, 0, 2),
  (4, 10, 0, 1),
  (5, 10, 4, 0),
  (6, 10, 6, 0),
  (7, 10, 8, 0),
  (8, 10, 10, 0);
