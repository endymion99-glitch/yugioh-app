// Data-access functions. Every function takes the better-sqlite3 handle so
// it can be exercised against an in-memory database in tests.

const CARD_COLUMNS = `
  c.card_id AS id, c.name, c.type, c.frame_type AS frameType, c.race,
  c.attribute, c.level, c.linkval, c."desc" AS "desc", c.atk, c.def,
  c.image_url AS imageUrl`

// ---------------------------------------------------------------- users --

export function countUsers(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n
}

export function getUserByUsername(db, username) {
  return db
    .prepare('SELECT id, username, password_hash AS passwordHash FROM users WHERE username = ?')
    .get(username)
}

export function createUser(db, username, passwordHash) {
  const info = db
    .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(username, passwordHash)
  return { id: Number(info.lastInsertRowid), username }
}

// ---------------------------------------------------------- cards_cache --

/** Upserts normalized cards ({id, name, type, ...}) into the cache. */
export function upsertCards(db, cards) {
  const stmt = db.prepare(`
    INSERT INTO cards_cache
      (card_id, name, type, frame_type, race, attribute, level, linkval, "desc", atk, def, image_url, fetched_at)
    VALUES
      (@id, @name, @type, @frameType, @race, @attribute, @level, @linkval, @desc, @atk, @def, @imageUrl, CURRENT_TIMESTAMP)
    ON CONFLICT(card_id) DO UPDATE SET
      name = excluded.name, type = excluded.type, frame_type = excluded.frame_type,
      race = excluded.race, attribute = excluded.attribute, level = excluded.level,
      linkval = excluded.linkval, "desc" = excluded."desc", atk = excluded.atk,
      def = excluded.def, image_url = excluded.image_url, fetched_at = CURRENT_TIMESTAMP`)
  const tx = db.transaction((rows) => {
    for (const card of rows) {
      stmt.run({
        id: card.id,
        name: card.name,
        type: card.type ?? null,
        frameType: card.frameType ?? null,
        race: card.race ?? null,
        attribute: card.attribute ?? null,
        level: card.level ?? null,
        linkval: card.linkval ?? null,
        desc: card.desc ?? null,
        atk: card.atk ?? null,
        def: card.def ?? null,
        imageUrl: card.imageUrl ?? null
      })
    }
  })
  tx(cards)
}

export function getCachedCard(db, cardId) {
  return db.prepare(`SELECT ${CARD_COLUMNS} FROM cards_cache c WHERE c.card_id = ?`).get(cardId)
}

export function getCachedCardByName(db, name) {
  return db
    .prepare(`SELECT ${CARD_COLUMNS} FROM cards_cache c WHERE c.name = ? COLLATE NOCASE`)
    .get(name)
}

/** Case-insensitive substring search over cached cards. */
export function searchCachedCards(db, query, limit = 30) {
  const q = `%${String(query).replace(/[\\%_]/g, (m) => '\\' + m)}%`
  return db
    .prepare(
      `SELECT ${CARD_COLUMNS} FROM cards_cache c
       WHERE c.name LIKE ? ESCAPE '\\'
       ORDER BY (c.name LIKE ? ESCAPE '\\') DESC, length(c.name), c.name
       LIMIT ?`
    )
    .all(q, q.slice(1), limit)
}

// ----------------------------------------------------------- collection --

export function listCollection(db, userId) {
  return db
    .prepare(
      `SELECT ${CARD_COLUMNS}, col.quantity
       FROM collection col JOIN cards_cache c ON c.card_id = col.card_id
       WHERE col.user_id = ?
       ORDER BY c.name COLLATE NOCASE`
    )
    .all(userId)
}

/** Map of card id -> owned quantity. */
export function ownedQuantities(db, userId) {
  const rows = db
    .prepare('SELECT card_id AS cardId, quantity FROM collection WHERE user_id = ?')
    .all(userId)
  return new Map(rows.map((r) => [r.cardId, r.quantity]))
}

/** Adds copies to the collection; existing quantities are incremented. */
export function addToCollection(db, userId, items) {
  const stmt = db.prepare(`
    INSERT INTO collection (user_id, card_id, quantity) VALUES (?, ?, ?)
    ON CONFLICT(user_id, card_id) DO UPDATE SET quantity = quantity + excluded.quantity`)
  const tx = db.transaction((rows) => {
    let added = 0
    for (const { cardId, quantity } of rows) {
      const n = Math.floor(Number(quantity))
      if (!Number.isFinite(n) || n <= 0) continue
      stmt.run(userId, cardId, n)
      added += n
    }
    return added
  })
  return tx(items)
}

/** Sets an exact quantity; zero or less removes the card. */
export function setCollectionQuantity(db, userId, cardId, quantity) {
  const n = Math.floor(Number(quantity))
  if (!Number.isFinite(n) || n <= 0) {
    db.prepare('DELETE FROM collection WHERE user_id = ? AND card_id = ?').run(userId, cardId)
    return 0
  }
  db.prepare(
    `INSERT INTO collection (user_id, card_id, quantity) VALUES (?, ?, ?)
     ON CONFLICT(user_id, card_id) DO UPDATE SET quantity = excluded.quantity`
  ).run(userId, cardId, n)
  return n
}

// ---------------------------------------------------------------- decks --

export function listDecks(db, userId) {
  return db
    .prepare(
      `SELECT d.id, d.name, d.created_at AS createdAt, d.updated_at AS updatedAt,
         COALESCE(SUM(CASE WHEN dc.section = 'main'  THEN dc.quantity END), 0) AS mainCount,
         COALESCE(SUM(CASE WHEN dc.section = 'extra' THEN dc.quantity END), 0) AS extraCount,
         COALESCE(SUM(CASE WHEN dc.section = 'side'  THEN dc.quantity END), 0) AS sideCount,
         (SELECT dc2.card_id FROM deck_cards dc2 WHERE dc2.deck_id = d.id AND dc2.section = 'main'
            ORDER BY dc2.quantity DESC, dc2.id LIMIT 1) AS coverCardId
       FROM decks d LEFT JOIN deck_cards dc ON dc.deck_id = d.id
       WHERE d.user_id = ?
       GROUP BY d.id
       ORDER BY d.updated_at DESC, d.id DESC`
    )
    .all(userId)
}

function getDeckRow(db, userId, deckId) {
  return db
    .prepare(
      `SELECT id, name, created_at AS createdAt, updated_at AS updatedAt
       FROM decks WHERE id = ? AND user_id = ?`
    )
    .get(deckId, userId)
}

/** Deck with its cards, or undefined if it isn't this user's deck. */
export function getDeck(db, userId, deckId) {
  const deck = getDeckRow(db, userId, deckId)
  if (!deck) return undefined
  deck.cards = db
    .prepare(
      `SELECT ${CARD_COLUMNS}, dc.section, dc.quantity
       FROM deck_cards dc JOIN cards_cache c ON c.card_id = dc.card_id
       WHERE dc.deck_id = ?
       ORDER BY dc.section, c.name COLLATE NOCASE`
    )
    .all(deckId)
  return deck
}

export function createDeck(db, userId, name) {
  const info = db.prepare('INSERT INTO decks (user_id, name) VALUES (?, ?)').run(userId, name)
  return getDeck(db, userId, Number(info.lastInsertRowid))
}

export function renameDeck(db, userId, deckId, name) {
  const info = db
    .prepare(
      'UPDATE decks SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?'
    )
    .run(name, deckId, userId)
  return info.changes > 0
}

export function deleteDeck(db, userId, deckId) {
  const info = db.prepare('DELETE FROM decks WHERE id = ? AND user_id = ?').run(deckId, userId)
  return info.changes > 0
}

/** Replaces the deck's card list. Entries: {cardId, section, quantity}. */
export function saveDeckCards(db, userId, deckId, entries) {
  const tx = db.transaction(() => {
    if (!getDeckRow(db, userId, deckId)) throw new Error('Deck not found')
    db.prepare('DELETE FROM deck_cards WHERE deck_id = ?').run(deckId)
    const ins = db.prepare(
      `INSERT INTO deck_cards (deck_id, card_id, section, quantity) VALUES (?, ?, ?, ?)
       ON CONFLICT(deck_id, card_id, section) DO UPDATE SET quantity = quantity + excluded.quantity`
    )
    for (const e of entries) {
      if (e.quantity > 0) ins.run(deckId, e.cardId, e.section, e.quantity)
    }
    db.prepare('UPDATE decks SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(deckId)
  })
  tx()
  return getDeck(db, userId, deckId)
}
