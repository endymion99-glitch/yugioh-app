// Builds resources/art-index.bin: an artwork fingerprint for every card
// image on YGOprodeck, so the app can recognise cards by their picture.
//
//   npm run art-index
//
// Incremental: images already in an existing index are kept, so refreshing
// only downloads cards added since. Stays under YGOprodeck's rate limit
// (20 requests/second). YGO_API_BASE / YGO_IMAGE_BASE point it at a mock.

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import jpeg from 'jpeg-js'
import { fingerprintCard, encodeArtIndex, decodeArtIndex } from '../src/shared/artHash.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'resources/art-index.bin')
const API = process.env.YGO_API_BASE || 'https://db.ygoprodeck.com/api/v7/cardinfo.php'
const IMAGES = process.env.YGO_IMAGE_BASE || 'https://images.ygoprodeck.com/images'
const CONCURRENCY = 8
const MIN_INTERVAL_MS = 1000 / 15

async function loadExisting() {
  try {
    return decodeArtIndex(new Uint8Array(await readFile(OUT))).entries
  } catch {
    return []
  }
}

let lastStart = 0
async function politeFetch(url, attempt = 1) {
  const wait = lastStart + MIN_INTERVAL_MS - Date.now()
  lastStart = Math.max(Date.now(), lastStart + MIN_INTERVAL_MS)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  try {
    const res = await fetch(url)
    if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`)
    return res
  } catch (err) {
    if (attempt >= 4) throw err
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
    return politeFetch(url, attempt + 1)
  }
}

function decodeImage(buf) {
  const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 256 })
  return { px: img.data, w: img.width, h: img.height }
}

async function main() {
  const existing = await loadExisting()
  const known = new Map(existing.map((e) => [e.imageId, e]))
  console.log(`Existing index: ${existing.length} images`)

  let res
  try {
    res = await politeFetch(API)
  } catch (err) {
    if (existing.length) {
      console.warn(`Could not reach the card database (${err.message}); keeping the existing index.`)
      return
    }
    throw err
  }
  if (!res.ok) throw new Error(`Card list request failed: HTTP ${res.status}`)
  const { data } = await res.json()

  // Every artwork (alternate arts have their own image ids) -> its card.
  const wanted = new Map()
  for (const card of data) {
    for (const img of card.card_images || [{ id: card.id }]) wanted.set(Number(img.id), Number(card.id))
  }
  const todo = [...wanted.keys()].filter((id) => !known.has(id))
  console.log(`${wanted.size} artworks listed, ${todo.length} to fingerprint`)

  const fresh = []
  let failed = 0
  let done = 0
  let next = 0
  const worker = async () => {
    while (next < todo.length) {
      const imageId = todo[next++]
      try {
        const r = await politeFetch(`${IMAGES}/cards_small/${imageId}.jpg`)
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const { px, w, h } = decodeImage(new Uint8Array(await r.arrayBuffer()))
        const fp = fingerprintCard(px, w, h, { x: 0, y: 0, w, h })
        fresh.push({ imageId, cardId: wanted.get(imageId), ...fp })
      } catch (err) {
        failed++
        if (failed <= 20) console.warn(`  skipped ${imageId}: ${err.message}`)
      }
      if (++done % 500 === 0) console.log(`  ${done} / ${todo.length}`)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  // Keep entries for artworks still listed; card ids may have been remapped.
  const entries = [
    ...existing.filter((e) => wanted.has(e.imageId)).map((e) => ({ ...e, cardId: wanted.get(e.imageId) })),
    ...fresh
  ].sort((a, b) => a.imageId - b.imageId)

  if (!entries.length) throw new Error('No artworks could be fingerprinted.')
  // Save whatever we have: the next run only retries what's missing.
  await mkdir(dirname(OUT), { recursive: true })
  await writeFile(OUT, encodeArtIndex(entries))
  console.log(`Wrote ${entries.length} of ${wanted.size} artworks (${failed} failed) to ${OUT}`)
  if (entries.length < wanted.size * 0.9) {
    throw new Error(`Only ${entries.length} of ${wanted.size} artworks could be fingerprinted.`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
