// SQLite schema, versioned with PRAGMA user_version.
//
// Each entry in MIGRATIONS upgrades the database by exactly one version.
// Never edit a migration that has shipped — append a new one instead.

export const MIGRATIONS = [
  // v1 — initial schema (matches the spec, plus indexes, cascades and a few
  // extra card fields that the UI shows in the card detail view).
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Cached card data from the YGOprodeck API. "desc" is quoted because it is
  -- an SQL keyword.
  CREATE TABLE cards_cache (
    card_id    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    type       TEXT,
    frame_type TEXT,
    race       TEXT,
    attribute  TEXT,
    level      INTEGER,
    linkval    INTEGER,
    "desc"     TEXT,
    atk        INTEGER,
    def        INTEGER,
    image_url  TEXT,
    fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX idx_cards_cache_name ON cards_cache(name COLLATE NOCASE);

  CREATE TABLE collection (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id  INTEGER NOT NULL,
    card_id  INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity > 0),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (card_id) REFERENCES cards_cache(card_id),
    UNIQUE(user_id, card_id)
  );

  CREATE TABLE decks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    name       TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX idx_decks_user ON decks(user_id);

  CREATE TABLE deck_cards (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    deck_id  INTEGER NOT NULL,
    card_id  INTEGER NOT NULL,
    section  TEXT NOT NULL CHECK(section IN ('main', 'extra', 'side')),
    quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity > 0),
    FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE,
    FOREIGN KEY (card_id) REFERENCES cards_cache(card_id),
    UNIQUE(deck_id, card_id, section)
  );
  CREATE INDEX idx_deck_cards_deck ON deck_cards(deck_id);
  `
]

export const SCHEMA_VERSION = MIGRATIONS.length
