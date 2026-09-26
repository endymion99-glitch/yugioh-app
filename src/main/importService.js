// Turns screenshots, .txt card lists and .ydk files into a review result:
//   { found: [{card, quantity, from}], unrecognized: [{text, quantity}] }
// Nothing is written to the collection here — the player confirms first.

import { parseCardList } from '@shared/textImport.js'
import { parseYdk } from '@shared/ydk.js'
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
 *   {cards: [{rect, name, nameAlt, qtyGlyphs: [png]}]} when a card grid
 *   was found, otherwise {full: <png bytes>}
 */
export async function importScreenshot(api, ocr, payload, onProgress) {
  const report = (stage, done, total) => onProgress?.({ stage, done, total })
  let candidates
  let card
  let unreadable = []

  if (payload.cards?.length) {
    const cells = payload.cards
    let done = 0
    report('ocr', 0, cells.length)
    candidates = []
    await Promise.all(
      cells.map(async (cell, i) => {
        const first = await ocr.recognizeName(cell.name)
        // Only try the inverted strip when the first read looks doubtful.
        const second =
          !pickName([first]) || first.confidence < 75 ? await ocr.recognizeName(cell.nameAlt) : null
        const name = pickName([first, second])
        const qtyReads = await Promise.all((cell.qtyGlyphs || []).map((g) => ocr.recognizeQuantity(g)))
        const quantity = pickQuantity(qtyReads) ?? 1
        const bbox = { x0: cell.rect.x, y0: cell.rect.y, x1: cell.rect.x + cell.rect.w, y1: cell.rect.y + cell.rect.h }
        if (name) candidates[i] = { text: name.text, quantity, confidence: name.confidence, bbox }
        else unreadable[i] = { text: `Card ${i + 1} — name unreadable`, quantity }
        report('ocr', ++done, cells.length)
      })
    )
    candidates = candidates.filter(Boolean)
    unreadable = unreadable.filter(Boolean)
    const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1]
    card = { width: median(cells.map((c) => c.rect.w)), height: median(cells.map((c) => c.rect.h)) }
  } else if (payload.full) {
    report('ocr', 0, 1)
    const lines = await ocr.recognizeLines(payload.full)
    ;({ candidates, card } = extractCandidates(lines))
  } else {
    throw new Error('No image received.')
  }

  // Identical text is looked up once.
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

  const totals = mergeMatches(matched, card)
  const found = []
  for (const [cardId, quantity] of totals) {
    const from = matched.find((m) => m.cardId === cardId).text
    found.push({ card: cardsById.get(cardId), quantity, from })
  }
  return { found, unrecognized: [...unrecognized.values(), ...unreadable] }
}
