// Finds card rectangles in a screenshot of cards laid out on a plain
// background (the YGOprodeck pack-opening view). Pure pixel math so it runs
// in the renderer (on canvas data) and in tests.

export const CARD_ASPECT = 614 / 421 // height / width of a card image

// Regions of a card image, as fractions of its width / height.
export const NAME_REGION = { x0: 0.04, y0: 0.025, x1: 0.84, y1: 0.125 }
export const QTY_REGION = { x0: 0.55, y0: 0.76, x1: 1.0, y1: 1.0 }

const BG_TOLERANCE = 40
const MIN_CARD_HEIGHT = 40 // px; smaller than this is unreadable anyway

/** Background colour: the most common colour along the image border. */
export function dominantBorderColor(px, w, h) {
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
    const rawCols = runs(w, (x) => colFrac[x] > 0.3)
    const plausible = rawCols.filter(([a, b]) => b - a >= bandH * 0.2)
    if (!plausible.length) continue

    // Card width from the narrowest plausible column; touching cards show
    // up as one wide run and get split evenly.
    const singleWidths = plausible.map(([a, b]) => b - a).filter((cw) => bandH / cw >= 1.2)
    const cardW = singleWidths.length ? median(singleWidths) : bandH / CARD_ASPECT
    const cardH = cardW * CARD_ASPECT
    if (cardH < MIN_CARD_HEIGHT) continue

    // Dark artwork close to the background colour can split one card into
    // pieces; rejoin pieces that fit within one card width, then square up
    // any column that still came out narrow.
    const cols = []
    for (const [a, b] of rawCols) {
      const last = cols[cols.length - 1]
      if (last && b - last[0] <= cardW * 1.08) last[1] = b
      else cols.push([a, b])
    }
    for (let i = cols.length - 1; i >= 0; i--) {
      const [a, b] = cols[i]
      if (b - a < cardW * 0.6) cols.splice(i, 1)
      else if (b - a < cardW * 0.9) cols[i][1] = Math.min(w, Math.round(a + cardW))
    }
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

/**
 * Finds the card-name caption printed under a card (YGOprodeck shows the name
 * and rarity beneath each card image). Returns the rectangle of the first
 * text line below the card, or null when there is none.
 *
 * @param {number[]} bg background colour from dominantBorderColor()
 */
export function findCaption(px, w, h, card, bg) {
  const x0 = Math.max(0, card.x - Math.round(card.w * 0.1))
  const x1 = Math.min(w, card.x + card.w + Math.round(card.w * 0.1))
  const yStart = Math.min(h, card.y + card.h + 1)
  const yEnd = Math.min(h, card.y + card.h + Math.round(card.h * 0.35))
  const isInk = (x, y) => {
    const o = (y * w + x) * 4
    return (
      Math.max(Math.abs(px[o] - bg[0]), Math.abs(px[o + 1] - bg[1]), Math.abs(px[o + 2] - bg[2])) > 60
    )
  }
  const rowInk = (y) => {
    let n = 0
    for (let x = x0; x < x1; x++) if (isInk(x, y)) n++
    return n
  }

  const minH = Math.max(4, card.h * 0.03)
  const maxH = card.h * 0.18
  for (const [a, b] of runs(yEnd - yStart, (i) => rowInk(yStart + i) >= 2, 1)) {
    const ya = yStart + a
    const yb = yStart + b
    if (a === 0 && b - a < minH) continue // the card's own bottom edge
    if (b - a < minH || b - a > maxH) continue
    let minX = x1
    let maxX = x0
    for (let y = ya; y < yb; y++) {
      for (let x = x0; x < x1; x++) {
        if (isInk(x, y)) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
        }
      }
    }
    const m = Math.max(2, Math.round((yb - ya) * 0.3))
    const rx = Math.max(0, minX - m)
    const ry = Math.max(0, ya - m)
    return {
      x: rx,
      y: ry,
      w: Math.min(w, maxX + 1 + m) - rx,
      h: Math.min(h, yb + m) - ry
    }
  }
  return null
}
