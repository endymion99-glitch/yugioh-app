import { describe, it, expect } from 'vitest'
import {
  fingerprintCard,
  artDistance,
  encodeArtIndex,
  decodeArtIndex,
  ArtIndex,
  ART_CONFIDENT,
  ART_MISMATCH
} from '../src/shared/artHash.js'

// A deterministic "card": frame colour plus a pseudo-random blobby artwork.
function cardImage(seed, w = 168, h = 245) {
  const px = new Uint8ClampedArray(w * h * 4)
  let s = seed
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const blobs = Array.from({ length: 6 }, () => ({
    x: rnd(),
    y: rnd(),
    r: 0.1 + rnd() * 0.25,
    c: [rnd() * 255, rnd() * 255, rnd() * 255]
  }))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w
      const v = y / h
      let c = [200, 170, 110] // frame
      if (u > 0.12 && u < 0.88 && v > 0.18 && v < 0.7) {
        c = [40 + 60 * u, 40 + 80 * v, 90]
        for (const b of blobs) {
          const dx = (u - 0.12) / 0.76 - b.x
          const dy = (v - 0.18) / 0.52 - b.y
          if (dx * dx + dy * dy < b.r * b.r) c = b.c
        }
      }
      px.set([c[0], c[1], c[2], 255], (y * w + x) * 4)
    }
  }
  return { px, w, h }
}

// Nearest-neighbour rescale plus a little noise, like a screenshot.
function screenshotOf(img, scale, noise = 6) {
  const w = Math.round(img.w * scale)
  const h = Math.round(img.h * scale)
  const px = new Uint8ClampedArray(w * h * 4)
  let s = 7
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (Math.floor(y / scale) * img.w + Math.floor(x / scale)) * 4
      for (let k = 0; k < 3; k++) {
        s = (s * 1103515245 + 12345) & 0x7fffffff
        px[(y * w + x) * 4 + k] = img.px[o + k] + ((s % (2 * noise + 1)) - noise)
      }
      px[(y * w + x) * 4 + 3] = 255
    }
  }
  return { px, w, h }
}

const fpOf = ({ px, w, h }) => fingerprintCard(px, w, h, { x: 0, y: 0, w, h })

describe('fingerprints', () => {
  it('match the same artwork at a different size', () => {
    const img = cardImage(1)
    const d = artDistance(fpOf(img), fpOf(screenshotOf(img, 0.6)))
    expect(d).toBeLessThan(ART_CONFIDENT)
  })

  it('tolerate a couple of pixels of misalignment', () => {
    const img = cardImage(2)
    const shot = screenshotOf(img, 0.6)
    const fp = fingerprintCard(shot.px, shot.w, shot.h, { x: 2, y: 1, w: shot.w - 2, h: shot.h - 2 })
    expect(artDistance(fpOf(img), fp)).toBeLessThan(ART_CONFIDENT)
  })

  it('separate different artworks', () => {
    for (let seed = 10; seed < 20; seed++) {
      expect(artDistance(fpOf(cardImage(seed)), fpOf(cardImage(seed + 100)))).toBeGreaterThan(ART_MISMATCH)
    }
  })
})

describe('ArtIndex', () => {
  const entries = [1, 2, 3, 4, 5].map((n) => ({ imageId: n * 10, cardId: n, ...fpOf(cardImage(n)) }))
  // An alternate artwork of card 1.
  entries.push({ imageId: 11, cardId: 1, ...fpOf(cardImage(99)) })

  it('round-trips through the binary format', () => {
    const decoded = decodeArtIndex(encodeArtIndex(entries, 1234))
    expect(decoded.builtAt).toBe(1234)
    expect(decoded.entries).toEqual(entries)
    expect(() => decodeArtIndex(new Uint8Array(16))).toThrow()
  })

  it('finds cards confidently, including by alternate artwork', () => {
    const index = new ArtIndex(decodeArtIndex(encodeArtIndex(entries)))
    expect(index.size).toBe(5)
    expect(index.match(fpOf(screenshotOf(cardImage(3), 0.55)))).toMatchObject({ cardId: 3, confident: true })
    expect(index.match(fpOf(screenshotOf(cardImage(99), 0.55)))).toMatchObject({ cardId: 1, confident: true })
  })

  it('is not confident about an artwork it has never seen', () => {
    const index = new ArtIndex({ entries, builtAt: 0 })
    expect(index.match(fpOf(cardImage(500))).confident).toBe(false)
  })

  it('is not confident when two different cards share the artwork', () => {
    const twins = [...entries, { imageId: 60, cardId: 6, ...fpOf(cardImage(3)) }]
    const index = new ArtIndex({ entries: twins, builtAt: 0 })
    expect(index.match(fpOf(screenshotOf(cardImage(3), 0.55))).confident).toBe(false)
  })

  it('measures distance to a specific card', () => {
    const index = new ArtIndex({ entries, builtAt: 0 })
    const fp = fpOf(screenshotOf(cardImage(2), 0.55))
    expect(index.distanceToCard(2, fp)).toBeLessThan(ART_CONFIDENT)
    expect(index.distanceToCard(4, fp)).toBeGreaterThan(ART_MISMATCH)
    expect(index.distanceToCard(999, fp)).toBeNull()
  })
})
