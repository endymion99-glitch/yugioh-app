import { describe, it, expect } from 'vitest'
import { extractCandidates, mergeMatches, cleanOcrText } from '../src/shared/ocrParse.js'

// Builds a fake Tesseract line from words laid out left to right.
function line(words, y, { h = 20, conf = 90 } = {}) {
  let x = words[0].x
  const ws = words.map((w) => {
    const x0 = w.x ?? x
    const x1 = x0 + w.text.length * 10
    x = x1 + 8
    return { text: w.text, confidence: w.conf ?? conf, bbox: { x0, y0: y, x1, y1: y + h } }
  })
  return {
    text: ws.map((w) => w.text).join(' '),
    confidence: conf,
    bbox: { x0: ws[0].bbox.x0, y0: y, x1: ws[ws.length - 1].bbox.x1, y1: y + h },
    words: ws
  }
}

// A 3x2 grid of cards 300px wide / 440px tall, names at the top and
// quantities near the bottom-right corner.
const lines = [
  line([{ text: 'Dark', x: 20 }, { text: 'Magician' }], 10),
  line([{ text: 'Pot', x: 320 }, { text: 'of' }, { text: 'Greed' }], 10),
  line([{ text: 'Mirror', x: 620 }, { text: 'Force' }], 10),
  line([{ text: 'x2', x: 270 }], 400),
  line([{ text: '3', x: 870 }], 400),
  line([{ text: 'Kuriboh', x: 20 }], 450),
  line([{ text: 'Raigeki', x: 320 }], 450),
  line([{ text: '~~', x: 620, conf: 30 }], 450),
  line([{ text: 'Raigeki', x: 320 }], 520)
]

describe('extractCandidates', () => {
  const { candidates, card } = extractCandidates(lines)
  const byText = Object.fromEntries(candidates.map((c) => [c.text, c]))

  it('finds names and ignores noise', () => {
    expect(Object.keys(byText).sort()).toEqual(
      ['Dark Magician', 'Kuriboh', 'Mirror Force', 'Pot of Greed', 'Raigeki'].sort()
    )
  })

  it('estimates the grid size', () => {
    expect(card.width).toBeCloseTo(300, -1)
    expect(card.height).toBeCloseTo(440, -1)
  })

  it('attaches quantities to the card above', () => {
    expect(byText['Dark Magician'].quantity).toBe(2)
    expect(byText['Mirror Force'].quantity).toBe(3)
    expect(byText['Pot of Greed'].quantity).toBe(1)
    expect(byText['Kuriboh'].quantity).toBe(1)
  })

  it('splits two names OCR merged onto one line', () => {
    const merged = line([{ text: 'Dark', x: 20 }, { text: 'Magician' }, { text: 'Kuriboh', x: 320 }], 10)
    const r = extractCandidates([merged])
    expect(r.candidates.map((c) => c.text)).toEqual(['Dark Magician', 'Kuriboh'])
  })
})

describe('mergeMatches', () => {
  it('merges nearby detections and sums separate grid cells', () => {
    const { candidates, card } = extractCandidates(lines)
    const ids = { 'Dark Magician': 1, 'Pot of Greed': 2, 'Mirror Force': 3, Kuriboh: 4, Raigeki: 5 }
    const matches = candidates.map((c) => ({ cardId: ids[c.text], quantity: c.quantity, bbox: c.bbox }))
    // A second Kuriboh in a different grid cell.
    matches.push({ cardId: 4, quantity: 1, bbox: { x0: 620, y0: 890, x1: 690, y1: 910 } })
    const totals = mergeMatches(matches, card)
    expect(totals.get(1)).toBe(2)
    expect(totals.get(3)).toBe(3)
    expect(totals.get(4)).toBe(2)
    // The two Raigeki detections are in the same card (caption + name box).
    expect(totals.get(5)).toBe(1)
  })
})

describe('cleanOcrText', () => {
  it('trims edge noise but keeps an ellipsis', () => {
    expect(cleanOcrText('| Blue-Eyes White Dragon —')).toBe('Blue-Eyes White Dragon')
    expect(cleanOcrText('"Blue-Eyes Alternative Wh...')).toBe('Blue-Eyes Alternative Wh...')
  })
})
