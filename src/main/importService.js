// Turns screenshots, .txt card lists and .ydk files into a review result:
//   { found: [{card, quantity, from}], unrecognized: [{text, quantity}] }
// Nothing is written to the collection here — the player confirms first.

import { parseCardList } from '@shared/textImport.js'
import { parseYdk } from '@shared/ydk.js'
import { extractCandidates, mergeMatches } from '@shared/ocrParse.js'

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
 * @param {object} api YgoApi
 * @param {(image:Buffer, onProgress:(p:number)=>void)=>Promise<Array>} recognizeLines
 */
export async function importScreenshot(api, recognizeLines, image, onProgress) {
  onProgress?.({ stage: 'ocr', done: 0, total: 1 })
  const lines = await recognizeLines(image, (p) => onProgress?.({ stage: 'ocr', done: p, total: 1 }))
  const { candidates, card } = extractCandidates(lines)

  // Identical text is looked up once.
  const uniqueTexts = [...new Set(candidates.map((c) => c.text))]
  const matches = await mapWithProgress(uniqueTexts, (t) => api.matchName(t), (d, t) =>
    onProgress?.({ stage: 'matching', done: d, total: t })
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
  return { found, unrecognized: [...unrecognized.values()] }
}
