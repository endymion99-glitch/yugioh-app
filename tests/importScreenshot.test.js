import { describe, it, expect } from 'vitest'
import { importScreenshot } from '../src/main/importService.js'

const CARDS = {
  1: { id: 1, name: 'Dark Magician' },
  2: { id: 2, name: 'Mirror Force' },
  3: { id: 3, name: 'Steel Ogre Grotto #1' },
  4: { id: 4, name: 'Steel Ogre Grotto #2' },
  5: { id: 5, name: 'Pot of Greed' }
}
const byName = Object.fromEntries(Object.values(CARDS).map((c) => [c.name.toLowerCase(), c]))

// Crops are plain strings in these tests; the fake OCR just echoes them.
const ocr = {
  recognizeName: async (s) => ({ text: s ?? '', confidence: s ? 92 : 0, lines: [] }),
  recognizeQuantity: async (s) => ({ text: s, confidence: 95, lines: [] })
}

const api = {
  async matchName(text) {
    const t = text.toLowerCase().replace(/\.\.\.$/, '')
    const card = byName[t] ?? Object.values(CARDS).find((c) => c.name.toLowerCase().startsWith(t))
    return card ? { card, score: 1 } : null
  },
  async getByIds(ids) {
    return new Map(ids.map((id) => [id, CARDS[id] ?? null]))
  }
}

// Fingerprints carry the card they depict in color[0] so a fake index can
// answer; color[1] = 1 marks an artwork the index can't place confidently.
const art = (cardId, unsure = 0) => ({ hash: [0, 0], color: [cardId, unsure, ...Array(46).fill(0)] })
const artIndex = {
  match: (fp) => ({ cardId: fp.color[0], distance: 0.05, confident: !fp.color[1] }),
  distanceToCard: (cardId, fp) => (cardId === fp.color[0] ? 0.05 : 0.5)
}

const cell = (name, { qty = '1', artOf, unsure } = {}) => ({
  rect: { x: 0, y: 0, w: 100, h: 146 },
  name,
  nameAlt: name,
  qtyGlyphs: [qty],
  ...(artOf ? { art: art(artOf, unsure ? 1 : 0) } : {})
})

const run = (cells, index = artIndex) => importScreenshot(api, ocr, { cards: cells }, undefined, index)

describe('screenshot import: artwork + name', () => {
  it('confirms a card when artwork and name agree', async () => {
    const { found } = await run([cell('Dark Magician', { qty: '2', artOf: 1 })])
    expect(found).toEqual([
      expect.objectContaining({ card: CARDS[1], quantity: 2, via: 'art+name', flags: [], cells: [0] })
    ])
  })

  it('trusts the artwork but flags a name that points to another card', async () => {
    const { found } = await run([cell('Mirror Force', { artOf: 1 })])
    expect(found[0].card).toBe(CARDS[1])
    expect(found[0].flags).toEqual([{ type: 'name-differs', text: 'Mirror Force', altCard: CARDS[2] }])
  })

  it('flags a full name for a similar but different card', async () => {
    const { found } = await run([cell('Steel Ogre Grotto #1', { artOf: 4 })])
    expect(found[0].card).toBe(CARDS[4])
    expect(found[0].flags).toEqual([{ type: 'name-differs', text: 'Steel Ogre Grotto #1', altCard: CARDS[3] }])
  })

  it('does not flag a cut-off name that fits the artwork’s card', async () => {
    // The name alone would pick Grotto #1; the artwork says #2.
    const { found } = await run([cell('Steel Ogre Grot...', { artOf: 4 })])
    expect(found[0].card).toBe(CARDS[4])
    expect(found[0].flags).toEqual([])
  })

  it('uses the name when the artwork is unsure, and flags art that clearly differs', async () => {
    const { found } = await run([cell('Pot of Greed', { artOf: 2, unsure: true })])
    expect(found[0]).toMatchObject({ card: CARDS[5], via: 'name', flags: [{ type: 'art-differs' }] })
  })

  it('recognises a card by artwork alone when the name is unreadable', async () => {
    const { found, unrecognized } = await run([cell('', { artOf: 2 })])
    expect(found[0]).toMatchObject({ card: CARDS[2], via: 'art', from: 'artwork', flags: [] })
    expect(unrecognized).toEqual([])
  })

  it('adds up the same card found in several cells', async () => {
    const { found } = await run([
      cell('Dark Magician', { qty: '2', artOf: 1 }),
      cell('Pot of Greed', { artOf: 5 }),
      cell('Dark Magician', { qty: '3', artOf: 1 })
    ])
    expect(found.map((f) => [f.card.name, f.quantity, f.cells])).toEqual([
      ['Dark Magician', 5, [0, 2]],
      ['Pot of Greed', 1, [1]]
    ])
  })

  it('works on names alone without an artwork index', async () => {
    const { found, unrecognized } = await run([cell('Mirror Force', { artOf: 1 }), cell('Qwerty Zz')], null)
    expect(found[0]).toMatchObject({ card: CARDS[2], via: 'name', flags: [] })
    expect(unrecognized).toEqual([{ text: 'Qwerty Zz', quantity: 1 }])
  })
})
