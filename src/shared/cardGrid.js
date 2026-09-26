// Finds card rectangles in a screenshot of cards laid out on a plain
// background (the YGOprodeck pack-opening view). Pure pixel math so it runs
// in the renderer (on canvas data) and in tests.

export const CARD_ASPECT = 614 / 421 // height / width of a card image

// Regions of a card image, as fractions of its width / height.
export const NAME_REGION = { x0: 0.04, y0: 0.025, x1: 0.84, y1: 0.125 }
export const QTY_REGION = { x0: 0.55, y0: 0.76, x1: 1.0, y1: 1.0 }

const BG_TOLERANCE = 40
const MIN_CARD_HEIGHT = 40 // px; smaller than this is unreadable anyway

function dominantBorderColor(px, w, h) {
  const counts = new Map()
  const sample = (x, y) => {
    const o = (y * w + x) * 4
    const key = ((px[o] >> 3) << 10) | ((px[o + 1] >> 3) << 5) | (px[o + 2] >> 3)
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  const step = Math.max(1, Math.floor(Math.min(w, h) / 200))
  for (let x = 0; x < w; x += step) {
    sample(x, 0)
    sample(x, h - 1)
  }
  for (let y = 0; y < h; y += step) {
    sample(0, y)
    sample(w - 1, y)
  }
  let best = 0
  let bestN = -1
  for (const [k, n] of counts) if (n > bestN) [best, bestN] = [k, n]
  return [((best >> 10) & 31) * 8 + 4, ((best >> 5) & 31) * 8 + 4, (best & 31) * 8 + 4]
}

/** Runs of indices where pred(i) holds, bridging gaps up to maxGap. */
function runs(n, pred, maxGap = 2) {
  const out = []
  let start = -1
  let lastOn = -1
  for (let i = 0; i < n; i++) {
    if (pred(i)) {
      if (start === -1) start = i
      else if (i - lastOn - 1 > maxGap) {
        out.push([start, lastOn + 1])
        start = i
      }
      lastOn = i
    }
  }
  if (start !== -1) out.push([start, lastOn + 1])
  return out
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * @param {Uint8ClampedArray|Uint8Array} px RGBA pixels
 * @returns {Array<{x:number, y:number, w:number, h:number}>} card rectangles,
 *   in reading order (top-to-bottom, left-to-right)
 */
export function detectCardGrid(px, w, h) {
  const bg = dominantBorderColor(px, w, h)
  const fg = new Uint8Array(w * h)
  for (let i = 0, o = 0; i < w * h; i++, o += 4) {
    const d = Math.max(Math.abs(px[o] - bg[0]), Math.abs(px[o + 1] - bg[1]), Math.abs(px[o + 2] - bg[2]))
    fg[i] = d > BG_TOLERANCE ? 1 : 0
  }

  const rowFrac = new Float32Array(h)
  for (let y = 0; y < h; y++) {
    let s = 0
    for (let x = 0; x < w; x++) s += fg[y * w + x]
    rowFrac[y] = s / w
  }

  const rects = []
  const minSide = Math.min(w, h) * 0.05
  for (const [y0, y1] of runs(h, (y) => rowFrac[y] > 0.05)) {
    const bandH = y1 - y0
    if (bandH < minSide) continue

    const colFrac = new Float32Array(w)
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let y = y0; y < y1; y++) s += fg[y * w + x]
      colFrac[x] = s / bandH
    }
    const cols = runs(w, (x) => colFrac[x] > 0.5).filter(([a, b]) => b - a >= bandH * 0.2)
    if (!cols.length) continue

    // Card width from the narrowest plausible column; touching cards show
    // up as one wide run and get split evenly.
    const singleWidths = cols.map(([a, b]) => b - a).filter((cw) => bandH / cw >= 1.2)
    const cardW = singleWidths.length ? median(singleWidths) : bandH / CARD_ASPECT
    const cardH = cardW * CARD_ASPECT
    if (cardH < MIN_CARD_HEIGHT) continue
    const rowsInBand = Math.max(1, Math.round(bandH / cardH))
    const rowH = bandH / rowsInBand
    if (Math.abs(rowH - cardH) / cardH > 0.3) continue // not a band of cards

    for (let r = 0; r < rowsInBand; r++) {
      for (const [a, b] of cols) {
        const n = Math.max(1, Math.round((b - a) / cardW))
        const cw = (b - a) / n
        for (let k = 0; k < n; k++) {
          rects.push({
            x: Math.round(a + k * cw),
            y: Math.round(y0 + r * rowH),
            w: Math.round(cw),
            h: Math.round(rowH)
          })
        }
      }
    }
  }
  return rects
}

/** Pixel rectangle of a card sub-region (NAME_REGION / QTY_REGION). */
export function subRect(card, region) {
  return {
    x: Math.round(card.x + card.w * region.x0),
    y: Math.round(card.y + card.h * region.y0),
    w: Math.max(1, Math.round(card.w * (region.x1 - region.x0))),
    h: Math.max(1, Math.round(card.h * (region.y1 - region.y0)))
  }
}
