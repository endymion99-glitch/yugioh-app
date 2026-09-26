import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../src/main/db/index.js'
import { SCHEMA_VERSION } from '../src/main/db/schema.js'
import * as repo from '../src/main/db/repositories.js'

const card = (id, name, type = 'Effect Monster', extra = {}) => ({
  id,
  name,
  type,
  desc: `${name} text`,
  atk: 1000,
  def: 1000,
  imageUrl: `https://images.ygoprodeck.com/images/cards/${id}.jpg`,
  ...extra
})

let db
let user

beforeEach(() => {
  db = openDatabase(':memory:')
  user = repo.createUser(db, 'yugi', 'hash')
  repo.upsertCards(db, [
    card(89631139, 'Blue-Eyes White Dragon', 'Normal Monster'),
    card(46986414, 'Dark Magician', 'Normal Monster'),
    card(27548199, 'Borreload Dragon', 'Link Monster')
  ])
})

describe('schema', () => {
  it('creates every table and records the schema version', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r) => r.name)
    expect(tables).toEqual(
      expect.arrayContaining(['users', 'cards_cache', 'collection', 'decks', 'deck_cards'])
    )
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
  })

  it('enforces the deck_cards section check', () => {
    const deck = repo.createDeck(db, user.id, 'D')
    expect(() =>
      db
        .prepare('INSERT INTO deck_cards (deck_id, card_id, section) VALUES (?, ?, ?)')
        .run(deck.id, 89631139, 'graveyard')
    ).toThrow()
  })

  it('refuses collection rows for uncached cards (foreign keys on)', () => {
    expect(() => repo.addToCollection(db, user.id, [{ cardId: 1, quantity: 1 }])).toThrow()
  })
})

describe('users', () => {
  it('counts and looks up users', () => {
    expect(repo.countUsers(db)).toBe(1)
    expect(repo.getUserByUsername(db, 'yugi')).toMatchObject({ id: user.id, passwordHash: 'hash' })
  })
})

describe('cards cache', () => {
  it('round-trips card fields including desc', () => {
    expect(repo.getCachedCard(db, 46986414)).toMatchObject({
      id: 46986414,
      name: 'Dark Magician',
      desc: 'Dark Magician text',
      atk: 1000
    })
  })

  it('searches by substring, prefix matches first', () => {
    repo.upsertCards(db, [card(1, 'Magician of Faith'), card(2, 'Dark Magician Girl')])
    const names = repo.searchCachedCards(db, 'dark magician').map((c) => c.name)
    expect(names).toEqual(['Dark Magician', 'Dark Magician Girl'])
    expect(repo.searchCachedCards(db, '100%')).toEqual([])
  })

  it('finds cards by exact name ignoring case', () => {
    expect(repo.getCachedCardByName(db, 'dark magician')?.id).toBe(46986414)
  })
})

describe('collection', () => {
  it('adds, increments and sets quantities', () => {
    repo.addToCollection(db, user.id, [
      { cardId: 89631139, quantity: 2 },
      { cardId: 46986414, quantity: 1 }
    ])
    repo.addToCollection(db, user.id, [{ cardId: 89631139, quantity: 1 }])
    expect(repo.ownedQuantities(db, user.id).get(89631139)).toBe(3)

    repo.setCollectionQuantity(db, user.id, 46986414, 0)
    const list = repo.listCollection(db, user.id)
    expect(list.map((c) => [c.name, c.quantity])).toEqual([['Blue-Eyes White Dragon', 3]])
  })

  it('ignores non-positive quantities on add', () => {
    expect(repo.addToCollection(db, user.id, [{ cardId: 89631139, quantity: 0 }])).toBe(0)
    expect(repo.listCollection(db, user.id)).toEqual([])
  })
})

describe('decks', () => {
  it('creates, saves, lists, renames and deletes decks', () => {
    const deck = repo.createDeck(db, user.id, 'Dragons')
    repo.saveDeckCards(db, user.id, deck.id, [
      { cardId: 89631139, section: 'main', quantity: 3 },
      { cardId: 27548199, section: 'extra', quantity: 1 },
      { cardId: 46986414, section: 'side', quantity: 2 }
    ])

    const [summary] = repo.listDecks(db, user.id)
    expect(summary).toMatchObject({
      name: 'Dragons',
      mainCount: 3,
      extraCount: 1,
      sideCount: 2,
      coverCardId: 89631139
    })

    expect(repo.renameDeck(db, user.id, deck.id, 'Blue-Eyes')).toBe(true)
    expect(repo.getDeck(db, user.id, deck.id).cards).toHaveLength(3)

    expect(repo.deleteDeck(db, user.id, deck.id)).toBe(true)
    expect(db.prepare('SELECT COUNT(*) n FROM deck_cards').get().n).toBe(0)
  })

  it("does not expose another user's deck", () => {
    const deck = repo.createDeck(db, user.id, 'Mine')
    const other = repo.createUser(db, 'kaiba', 'hash')
    expect(repo.getDeck(db, other.id, deck.id)).toBeUndefined()
    expect(repo.renameDeck(db, other.id, deck.id, 'Stolen')).toBe(false)
  })
})
