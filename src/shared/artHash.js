// Artwork fingerprints for recognising cards by their picture.
//
// The same function fingerprints a card cut out of a screenshot and the
// official card images from YGOprodeck (when building the index), so both
// sides crop and shrink the artwork identically.
//
// A fingerprint is a 64-bit perceptual hash (DCT of a 32x32 greyscale
// thumbnail; robust to scaling and compression) plus a 4x4 colour thumbnail
// (separates artworks whose shapes happen to hash alike).

// The artwork box of a standard card, inset a little so a few pixels of
// misalignment don't pull the frame into the crop.
export const ART_REGION = { x0: 0.16, y0: 0.21, x1: 0.84, y1: 0.67 }

const HASH_SIZE = 32
const COLOR_GRID = 4

// Distance thresholds (see artDistance). Measured: the same artwork at
// different sizes/compression lands around 0.02–0.12; different artworks
// around 0.35–0.6.
export const ART_CONFIDENT = 0.2 // at or below: this is the card
export const ART_MARGIN = 0.08 // ...and the next different card is at least this much further
export const ART_MISMATCH = 0.3 // above: the artwork is not this card

/**
 * Average-resamples a rectangle of an RGBA image to outW x outH.
 * Returns interleaved RGB floats.
 */
export function resampleRgb(px, w, h, rect, outW, outH) {
  const out = new Float64Array(outW * outH * 3)
  const sx = rect.w / outW
  const sy = rect.h / outH
  for (let oy = 0; oy < outH; oy++) {
    const y0 = rect.y + oy * sy
    const y1 = y0 + sy
    for (let ox = 0; ox < outW; ox++) {
      const x0 = rect.x + ox * sx
      const x1 = x0 + sx
      let r = 0
      let g = 0
      let b = 0
      let area = 0
      for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
        if (y < 0 || y >= h) continue
        const wy = Math.min(y + 1, y1) - Math.max(y, y0)
        for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
          if (x < 0 || x >= w) continue
          const a = wy * (Math.min(x + 1, x1) - Math.max(x, x0))
          const o = (y * w + x) * 4
          r += px[o] * a
          g += px[o + 1] * a
          b += px[o + 2] * a
          area += a
        }
      }
      const o = (oy * outW + ox) * 3
      out[o] = area ? r / area : 0
      out[o + 1] = area ? g / area : 0
      out[o + 2] = area ? b / area : 0
    }
  }
  return out
}

// cos((2x+1)uπ/2N) for the 8 lowest frequencies.
const COS = (() => {
  const t = new Float64Array(8 * HASH_SIZE)
  for (let u = 0; u < 8; u++) {
    for (let x = 0; x < HASH_SIZE; x++) t[u * HASH_SIZE + x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * HASH_SIZE))
  }
  return t
})()

function phash(gray) {
  const N = HASH_SIZE
  // Separable 2D DCT, keeping only the 8x8 lowest frequencies.
  const rows = new Float64Array(N * 8)
  for (let y = 0; y < N; y++) {
    for (let u = 0; u < 8; u++) {
      let s = 0
      for (let x = 0; x < N; x++) s += gray[y * N + x] * COS[u * N + x]
      rows[y * 8 + u] = s
    }
  }
  const coeffs = new Float64Array(64)
  for (let v = 0; v < 8; v++) {
    for (let u = 0; u < 8; u++) {
      let s = 0
      for (let y = 0; y < N; y++) s += rows[y * 8 + u] * COS[v * N + y]
      coeffs[v * 8 + u] = s
    }
  }
  const ac = Array.from(coeffs.subarray(1)).sort((a, b) => a - b)
  const median = (ac[31] + ac[32]) / 2
  let hi = 0
  let lo = 0
  for (let i = 1; i < 64; i++) {
    if (coeffs[i] > median) {
      if (i < 32) hi |= 1 << i
      else lo |= 1 << (i - 32)
    }
  }
  return [hi >>> 0, lo >>> 0]
}

/**
 * Fingerprints the artwork of the card occupying `card` ({x,y,w,h}) in an
 * RGBA image. Returns {hash: [u32, u32], color: number[48]}.
 */
export function fingerprintCard(px, w, h, card) {
  const art = {
    x: card.x + card.w * ART_REGION.x0,
    y: card.y + card.h * ART_REGION.y0,
    w: card.w * (ART_REGION.x1 - ART_REGION.x0),
    h: card.h * (ART_REGION.y1 - ART_REGION.y0)
  }
  const rgb = resampleRgb(px, w, h, art, HASH_SIZE, HASH_SIZE)
  const gray = new Float64Array(HASH_SIZE * HASH_SIZE)
  for (let i = 0; i < gray.length; i++) {
    gray[i] = 0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2]
  }
  const small = resampleRgb(px, w, h, art, COLOR_GRID, COLOR_GRID)
  return { hash: phash(gray), color: Array.from(small, (v) => Math.round(v)) }
}

function popcount(n) {
  n -= (n >>> 1) & 0x55555555
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333)
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

/** 0 (identical) .. ~1 (unrelated). */
export function artDistance(a, b) {
  const bits = popcount(a.hash[0] ^ b.hash[0]) + popcount(a.hash[1] ^ b.hash[1])
  let diff = 0
  for (let i = 0; i < a.color.length; i++) diff += Math.abs(a.color[i] - b.color[i])
  return (bits / 64) * 0.75 + (diff / (a.color.length * 255)) * 0.75
}

// ------------------------------------------------------------ the index --
//
// Binary layout (little-endian):
//   "YGOA" | u32 version | u32 count | u32 builtAt (unix seconds)
//   count x { u32 imageId | u32 cardId | u32 hashHi | u32 hashLo | u8[48] color }

const MAGIC = 0x414f4759 // "YGOA"
const VERSION = 1
const HEADER = 16
const ENTRY = 16 + COLOR_GRID * COLOR_GRID * 3

/** @param {Array<{imageId:number, cardId:number, hash:number[], color:number[]}>} entries */
export function encodeArtIndex(entries, builtAt = Math.floor(Date.now() / 1000)) {
  const buf = new ArrayBuffer(HEADER + entries.length * ENTRY)
  const dv = new DataView(buf)
  dv.setUint32(0, MAGIC, true)
  dv.setUint32(4, VERSION, true)
  dv.setUint32(8, entries.length, true)
  dv.setUint32(12, builtAt, true)
  entries.forEach((e, i) => {
    const o = HEADER + i * ENTRY
    dv.setUint32(o, e.imageId, true)
    dv.setUint32(o + 4, e.cardId, true)
    dv.setUint32(o + 8, e.hash[0], true)
    dv.setUint32(o + 12, e.hash[1], true)
    for (let k = 0; k < e.color.length; k++) dv.setUint8(o + 16 + k, e.color[k])
  })
  return new Uint8Array(buf)
}

export function decodeArtIndex(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (dv.getUint32(0, true) !== MAGIC || dv.getUint32(4, true) !== VERSION) {
    throw new Error('Not an artwork index (or an unsupported version).')
  }
  const count = dv.getUint32(8, true)
  const builtAt = dv.getUint32(12, true)
  const entries = new Array(count)
  for (let i = 0; i < count; i++) {
    const o = HEADER + i * ENTRY
    const color = new Array(ENTRY - 16)
    for (let k = 0; k < color.length; k++) color[k] = dv.getUint8(o + 16 + k)
    entries[i] = {
      imageId: dv.getUint32(o, true),
      cardId: dv.getUint32(o + 4, true),
      hash: [dv.getUint32(o + 8, true), dv.getUint32(o + 12, true)],
      color
    }
  }
  return { builtAt, entries }
}

/** Looks cards up by artwork. */
export class ArtIndex {
  constructor({ entries, builtAt }) {
    this.entries = entries
    this.builtAt = builtAt
    this.byCard = new Map()
    for (const e of entries) {
      if (!this.byCard.has(e.cardId)) this.byCard.set(e.cardId, [])
      this.byCard.get(e.cardId).push(e)
    }
  }

  get size() {
    return this.byCard.size
  }

  /**
   * Best-matching card for a fingerprint: {cardId, distance, confident}.
   * Confident means close enough AND clearly closer than any other card
   * (alternate artworks of the same card don't count as rivals).
   */
  match(fp) {
    let best = null
    let runnerUp = Infinity
    for (const e of this.entries) {
      const d = artDistance(fp, e)
      if (!best || d < best.distance) {
        if (best && best.cardId !== e.cardId) runnerUp = Math.min(runnerUp, best.distance)
        best = { cardId: e.cardId, distance: d }
      } else if (e.cardId !== best.cardId && d < runnerUp) {
        runnerUp = d
      }
    }
    if (!best) return null
    const confident = best.distance <= ART_CONFIDENT && runnerUp - best.distance >= ART_MARGIN
    return { ...best, confident }
  }

  /** Distance from a fingerprint to a given card's artworks, or null if not indexed. */
  distanceToCard(cardId, fp) {
    const list = this.byCard.get(cardId)
    if (!list) return null
    return Math.min(...list.map((e) => artDistance(fp, e)))
  }
}
