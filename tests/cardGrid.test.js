import { describe, it, expect } from 'vitest'
import {
  detectCardGrid,
  dominantBorderColor,
  findCaption,
  subRect,
  NAME_REGION
} from '../src/shared/cardGrid.js'
import { findGlyphGroups } from '../src/shared/glyphs.js'
import { pickName, pickQuantity } from '../src/shared/ocrParse.js'

function canvas(w, h, bg) {
  const px = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) px.set([...bg, 255], i * 4)
  return {
    px,
    fill(x, y, fw, fh, rgb) {
      for (let yy = y; yy < y + fh; yy++) for (let xx = x; xx < x + fw; xx++) px.set([...rgb, 255], (yy * w + xx) * 4)
    }
  }
}

describe('detectCardGrid', () => {
  it('finds a grid of cards on a dark background', () => {
    const c = canvas(700, 520, [27, 27, 27])
    const W = 150
    const H = Math.round(W * (614 / 421))
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 4; col++) c.fill(20 + col * (W + 20), 20 + row * (H + 20), W, H, [210, 180, 110])
    }
    const rects = detectCardGrid(c.px, 700, 520)
    expect(rects).toHaveLength(8)
    expect(rects[0]).toMatchObject({ x: 20, y: 20, w: W, h: H })
    expect(rects[5]).toMatchObject({ x: 20 + (W + 20), y: 20 + H + 20 })
  })

  it('splits cards that touch each other', () => {
    const c = canvas(560, 300, [255, 255, 255])
    const W = 120
    const H = Math.round(W * (614 / 421))
    c.fill(10, 10, W * 3, H, [40, 90, 170])
    c.fill(10 + W * 3 + 30, 10, W, H, [40, 90, 170])
    const rects = detectCardGrid(c.px, 560, 300)
    expect(rects.map((r) => r.x)).toEqual([10, 10 + W, 10 + 2 * W, 10 + W * 3 + 30])
  })

  it('keeps a card whole when its artwork is close to the background colour', () => {
    const c = canvas(400, 260, [30, 31, 34])
    const W = 100
    const H = Math.round(W * (614 / 421))
    for (const x of [10, 130, 250]) c.fill(x, 10, W, H, [30, 160, 150])
    // Third card: dark art covering most of its right-hand side.
    c.fill(250 + 60, 30, 36, 110, [34, 33, 36])
    const rects = detectCardGrid(c.px, 400, 260)
    expect(rects.map((r) => [r.x, r.w])).toEqual([
      [10, W],
      [130, W],
      [250, W]
    ])
  })

  it('finds the name caption under a card, skipping nothing above it', () => {
    const c = canvas(300, 300, [30, 31, 34])
    const card = { x: 20, y: 10, w: 100, h: 146 }
    c.fill(card.x, card.y, card.w, card.h, [30, 160, 150])
    c.fill(35, 162, 70, 11, [230, 230, 230]) // name line
    c.fill(50, 181, 40, 11, [200, 200, 200]) // rarity line
    const bg = dominantBorderColor(c.px, 300, 300)
    const cap = findCaption(c.px, 300, 300, card, bg)
    expect(cap.y).toBeLessThanOrEqual(162)
    expect(cap.y + cap.h).toBeGreaterThanOrEqual(173)
    expect(cap.y + cap.h).toBeLessThan(181)
    expect(cap.x).toBeLessThanOrEqual(35)
    expect(findCaption(c.px, 300, 300, { x: 160, y: 10, w: 100, h: 146 }, bg)).toBeNull()
  })

  it('returns nothing for an image without cards', () => {
    const c = canvas(300, 200, [20, 20, 20])
    c.fill(10, 10, 280, 12, [200, 200, 200]) // a thin banner, not a card
    expect(detectCardGrid(c.px, 300, 200)).toEqual([])
  })

  it('computes sub-regions', () => {
    expect(subRect({ x: 100, y: 50, w: 200, h: 300 }, NAME_REGION)).toEqual({
      x: 108,
      y: 58,
      w: 160,
      h: 30
    })
  })
})

describe('findGlyphGroups', () => {
  // 120x80 corner: busy-ish background, a dark badge with two bright glyphs
  // at the bottom-right and a small bright speck elsewhere.
  function corner() {
    const w = 120
    const h = 80
    const lum = new Uint8ClampedArray(w * h).fill(180)
    const rect = (x, y, rw, rh, v) => {
      for (let yy = y; yy < y + rh; yy++) for (let xx = x; xx < x + rw; xx++) lum[yy * w + xx] = v
    }
    rect(70, 40, 44, 34, 10) // badge
    rect(76, 46, 12, 22, 250) // glyph 1 (as a block with a hole)
    rect(79, 50, 6, 14, 10)
    rect(92, 46, 14, 22, 250) // glyph 2
    rect(96, 50, 6, 14, 10)
    rect(10, 10, 3, 3, 250) // speck: too small to be a glyph
    return { lum, w, h }
  }

  it('finds the overlay digits as one group and renders a clean mask', () => {
    const { lum, w, h } = corner()
    const groups = findGlyphGroups(lum, w, h)
    expect(groups.length).toBeGreaterThanOrEqual(1)
    const g = groups[0]
    expect(g).toMatchObject({ x0: 76, y0: 46, x1: 106, y1: 68 })
    const ink = g.mask.reduce((s, v) => s + v, 0)
    expect(ink).toBe(12 * 22 - 6 * 14 + 14 * 22 - 6 * 14)
  })

  it('ignores the L-shaped corner of a card frame', () => {
    const w = 100
    const h = 80
    const lum = new Uint8ClampedArray(w * h).fill(170)
    for (let y = 40; y < 64; y++) for (let x = 60; x < 84; x++) {
      if (x >= 79 || y >= 59) lum[y * w + x] = 30
    }
    expect(findGlyphGroups(lum, w, h)).toEqual([])
  })

  it('finds nothing in a flat image', () => {
    expect(findGlyphGroups(new Uint8ClampedArray(60 * 40).fill(128), 60, 40)).toEqual([])
  })
})

describe('crop pickers', () => {
  it('picks the most confident plausible name', () => {
    expect(
      pickName([
        { text: '~~ ||', confidence: 90 },
        { text: 'Pot of Greed\n', confidence: 81 },
        { text: 'Pot of Grccd', confidence: 60 }
      ])
    ).toEqual({ text: 'Pot of Greed', confidence: 81 })
    expect(pickName([null, { text: '12', confidence: 99 }])).toBeNull()
  })

  it('reads quantities from the first confident digit result', () => {
    expect(pickQuantity([{ text: '2', confidence: 95 }])).toBe(2)
    expect(pickQuantity([{ text: 'x3', confidence: 88 }])).toBe(3)
    expect(pickQuantity([{ text: '7', confidence: 40 }, { text: '2', confidence: 91 }])).toBe(2)
    expect(pickQuantity([{ text: '2500', confidence: 95 }])).toBeNull()
    expect(pickQuantity([])).toBeNull()
  })
})
