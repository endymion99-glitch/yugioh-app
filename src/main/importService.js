// Turns screenshots, .txt card lists and .ydk files into a review result:
//   { found: [{card, quantity, from}], unrecognized: [{text, quantity}] }
// Nothing is written to the collection here — the player confirms first.

import { parseCardList } from '@shared/textImport.js'
import { parseYdk } from '@shared/ydk.js'
import { isTruncated, matchScore } from '@shared/fuzzy.js'
import { ART_MISMATCH } from '@shared/artHash.js'
import { extractCandidates, mergeMatches, pickName, pickQuantity } from '@shared/ocrParse.js'

function collect(found) {
  // Keep first-seen order, merge duplicates by card id.
  const byId = new Map()
  for (const f of found) {
    const prev = byId.get(f.card.id)
    if (prev) prev.quantity += f.quantity
    else byId.set(f.card.id, { ...f })
  }
  return [...byId.values()]
}

async function mapWithProgress(items, fn, onProgress) {
  let done = 0
  onProgress?.(0, items.length)
  return Promise.all(
    items.map(async (item) => {
      const r = await fn(item)
      onProgress?.(++done, items.length)
      return r
    })
  )
}

export async function importCardList(api, text, onProgress) {
  const entries = parseCardList(text)
  const results = await mapWithProgress(entries, (e) => api.matchName(e.name), (d, t) =>
    onProgress?.({ stage: 'matching', done: d, total: t })
  )
  const found = []
  const unrecognized = []
  entries.forEach((e, i) => {
    const m = results[i]
    if (m) found.push({ card: m.card, quantity: e.quantity, from: e.name })
    else unrecognized.push({ text: e.name, quantity: e.quantity })
  })
  return { found: collect(found), unrecognized }
}

export async function importYdk(api, text, onProgress) {
  const { all } = parseYdk(text)
  const ids = [...all.keys()]
  const cards = await api.getByIds(ids, (d, t) => onProgress?.({ stage: 'matching', done: d, total: t }))
  const found = []
  const unrecognized = []
  for (const id of ids) {
    const card = cards.get(id)
    if (card) found.push({ card, quantity: all.get(id), from: String(id) })
    else unrecognized.push({ text: `Passcode ${id}`, quantity: all.get(id) })
  }
  return { found: collect(found), unrecognized }
}

/**
 * Screenshot import.
 *
 * @param {object} api YgoApi
 * @param {object} ocr {recognizeName, recognizeQuantity, recognizeLines}
 * @param {object} payload from the renderer's prepareScreenshot():
 *   {cards: [{rect, name, nameAlt, boxName?, boxNameAlt?, qtyGlyphs: [png], art?}]}
 *   when a card grid was found, otherwise {full: <png bytes>}
 * @param {object} [onProgress]
 * @param {import('@shared/artHash.js').ArtIndex|null} [artIndex] enables
 *   recognising cards by their artwork
 */
export async function importScreenshot(api, ocr, payload, onProgress, artIndex = null) {
  const report = (stage, done, total) => onProgress?.({ stage, done, total })
  if (payload.cards?.length) return importGrid(api, ocr, payload.cards, report, artIndex)
  if (payload.full) return importFullImage(api, ocr, payload.full, report)
  throw new Error('No image received.')
}

const isFingerprint = (fp) =>
  Array.isArray(fp?.hash) &&
  fp.hash.length === 2 &&
  Array.isArray(fp.color) &&
  fp.color.length === 48 &&
  [...fp.hash, ...fp.color].every(Number.isFinite)

/**
 * One card per grid cell. Each card is identified by its artwork and by its
 * name; the artwork wins when it is a confident match, and any disagreement
 * between the two is flagged for the player to check.
 */
async function importGrid(api, ocr, cells, report, artIndex) {
  let done = 0
  report('ocr', 0, cells.length)
  const reads = await Promise.all(
    cells.map(async (cell) => {
      const first = await ocr.recognizeName(cell.name)
      // Only try the inverted strip when the first read looks doubtful.
      const second =
        !pickName([first]) || first.confidence < 75 ? await ocr.recognizeName(cell.nameAlt) : null
      const name = pickName([first, second])
      // A caption cut off with "..." can fit several cards; the tiny name
      // box on the card image helps pick the right one.
      let hint
      if (name && isTruncated(name.text) && cell.boxName) {
        const box = pickName(
          await Promise.all([ocr.recognizeName(cell.boxName), ocr.recognizeName(cell.boxNameAlt)])
        )
        hint = box?.text
      }
      const qtyReads = await Promise.all((cell.qtyGlyphs || []).map((g) => ocr.recognizeQuantity(g)))
      report('ocr', ++done, cells.length)
      return { name, hint, quantity: pickQuantity(qtyReads) ?? 1 }
    })
  )

  // Artwork.
  const arts = cells.map((cell) =>
    artIndex && isFingerprint(cell.art) ? artIndex.match(cell.art) : null
  )
  const artIds = [...new Set(arts.filter((a) => a?.confident).map((a) => a.cardId))]
  let artCards = new Map()
  if (artIds.length) {
    try {
      artCards = await api.getByIds(artIds)
    } catch {
      // Offline and not cached: fall back to names for these.
    }
  }

  // Names; identical text is looked up once.
  const keyOf = (r) => `${r.name.text}\u0000${r.hint || ''}`
  const named = [...new Map(reads.filter((r) => r.name).map((r) => [keyOf(r), r])).values()]
  const matches = await mapWithProgress(
    named,
    (r) => api.matchName(r.name.text, { hint: r.hint }),
    (d, t) => report('matching', d, t)
  )
  const byKey = new Map(named.map((r, i) => [keyOf(r), matches[i]]))

  const found = new Map()
  const unrecognized = new Map()
  reads.forEach((r, i) => {
    const nameMatch = r.name ? byKey.get(keyOf(r)) : null
    const art = arts[i]
    const artCard = art?.confident ? artCards.get(art.cardId) : null
    let card = null
    let via
    let flag = null

    if (artCard) {
      card = artCard
      via = nameMatch?.card.id === artCard.id ? 'art+name' : 'art'
      // The name points at a different real card, and isn't just a
      // cut-off caption ("Steel Ogre Grot...") that also fits the artwork's card.
      const fitsCutOff = isTruncated(r.name?.text) && matchScore(r.name.text, artCard.name) >= 0.85
      if (nameMatch && nameMatch.card.id !== artCard.id && !fitsCutOff) {
        flag = { type: 'name-differs', text: r.name.text, altCard: nameMatch.card }
      }
    } else if (nameMatch) {
      card = nameMatch.card
      via = 'name'
      const d = artIndex && isFingerprint(cells[i].art) ? artIndex.distanceToCard(card.id, cells[i].art) : null
      if (d !== null && d > ART_MISMATCH) flag = { type: 'art-differs' }
    }

    if (!card) {
      const text = r.name?.text ?? `Card ${i + 1} — name unreadable`
      const prev = unrecognized.get(text)
      if (prev) prev.quantity += r.quantity
      else unrecognized.set(text, { text, quantity: r.quantity })
      return
    }

    let item = found.get(card.id)
    if (!item) {
      item = { card, quantity: 0, from: via === 'art' ? 'artwork' : r.name.text, via, cells: [], flags: [] }
      found.set(card.id, item)
    }
    item.quantity += r.quantity
    item.cells.push(i)
    if (via === 'art+name') item.via = 'art+name'
    if (flag && !item.flags.some((f) => f.type === flag.type && f.altCard?.id === flag.altCard?.id)) {
      item.flags.push(flag)
    }
  })

  return { found: [...found.values()], unrecognized: [...unrecognized.values()] }
}

/** No card grid found: whole-image OCR, names only. */
async function importFullImage(api, ocr, image, report) {
  report('ocr', 0, 1)
  const lines = await ocr.recognizeLines(image)
  const { candidates, card } = extractCandidates(lines)

  const uniqueTexts = [...new Set(candidates.map((c) => c.text))]
  const matches = await mapWithProgress(uniqueTexts, (t) => api.matchName(t), (d, t) =>
    report('matching', d, t)
  )
  const byText = new Map(uniqueTexts.map((t, i) => [t, matches[i]]))

  const matched = []
  const cardsById = new Map()
  const unrecognized = new Map()
  for (const c of candidates) {
    const m = byText.get(c.text)
    if (m) {
      matched.push({ cardId: m.card.id, quantity: c.quantity, bbox: c.bbox, text: c.text })
      cardsById.set(m.card.id, m.card)
    } else {
      const prev = unrecognized.get(c.text)
      if (prev) prev.quantity += c.quantity
      else unrecognized.set(c.text, { text: c.text, quantity: c.quantity })
    }
  }

  const found = []
  for (const [cardId, quantity] of mergeMatches(matched, card)) {
    const from = matched.find((m) => m.cardId === cardId).text
    found.push({ card: cardsById.get(cardId), quantity, from, via: 'name', cells: [], flags: [] })
  }
  return { found, unrecognized: [...unrecognized.values()] }
}
