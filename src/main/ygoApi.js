// YGOprodeck API client. Every lookup checks the local cards_cache first and
// writes whatever the API returns back into it.

import {
  upsertCards,
  getCachedCard,
  getCachedCardByName,
  searchCachedCards
} from './db/repositories.js'
import { bestMatch, normalizeName, isTruncated, rankSearchResults } from '@shared/fuzzy.js'

export const API_BASE = 'https://db.ygoprodeck.com/api/v7/cardinfo.php'

// OCR / typed names scoring at least this against a real card name are
// treated as that card.
export const MATCH_THRESHOLD = 0.72

export class OfflineError extends Error {
  constructor(cause) {
    super('Could not reach YGOprodeck. Check your internet connection.')
    this.cause = cause
  }
}

/** Converts an API card object to the shape stored in cards_cache. */
export function normalizeApiCard(c) {
  const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v))
  return {
    id: Number(c.id),
    name: c.name,
    type: c.type ?? null,
    frameType: c.frameType ?? null,
    race: c.race ?? null,
    attribute: c.attribute ?? null,
    level: num(c.level),
    linkval: num(c.linkval),
    desc: c.desc ?? null,
    atk: num(c.atk),
    def: num(c.def),
    imageUrl: c.card_images?.[0]?.image_url ?? null
  }
}

/** Passcodes of every artwork of an API card (alternate arts have their own). */
function artworkIds(c) {
  return [Number(c.id), ...(c.card_images || []).map((i) => Number(i.id))]
}

/** Runs at most `concurrency` tasks at once, starting one every `intervalMs`. */
export function createLimiter({ concurrency = 4, intervalMs = 60 } = {}) {
  let active = 0
  let lastStart = 0
  const queue = []

  const pump = () => {
    if (active >= concurrency || !queue.length) return
    const wait = lastStart + intervalMs - Date.now()
    if (wait > 0) {
      setTimeout(pump, wait)
      return
    }
    const { fn, resolve, reject } = queue.shift()
    active++
    lastStart = Date.now()
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active--
        pump()
      })
    pump()
  }

  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject })
      pump()
    })
}

export class YgoApi {
  /**
   * @param {object} opts
   * @param {import('better-sqlite3').Database} opts.db
   * @param {typeof fetch} [opts.fetch]
   */
  constructor({ db, fetch: fetchImpl = globalThis.fetch, limiter = createLimiter() }) {
    this.db = db
    this.fetch = fetchImpl
    this.limit = limiter
    this.searchMemo = new Map()
  }

  /**
   * Raw query. Resolves to [{card, ids}] where ids are all artwork passcodes
   * of the card; [] when nothing matched. Results are written to the cache.
   */
  async queryWithIds(params) {
    const url = `${API_BASE}?${new URLSearchParams(params)}`
    let res
    try {
      res = await this.limit(() => this.fetch(url))
    } catch (err) {
      throw new OfflineError(err)
    }
    // The API answers 400 with {"error": "..."} when nothing matches.
    if (res.status === 400) return []
    if (!res.ok) throw new Error(`YGOprodeck API error: HTTP ${res.status}`)
    const json = await res.json()
    const rows = (json.data || []).map((c) => ({ card: normalizeApiCard(c), ids: artworkIds(c) }))
    if (rows.length) upsertCards(this.db, rows.map((r) => r.card))
    return rows
  }

  /** Normalized cards matching the query ([] when nothing matched). */
  async query(params) {
    return (await this.queryWithIds(params)).map((r) => r.card)
  }

  async getById(id) {
    const cached = getCachedCard(this.db, id)
    if (cached) return cached
    const [card] = await this.query({ id: String(id) })
    return card || null
  }

  /**
   * Looks up many passcodes. Alternate-artwork passcodes resolve to their
   * card's main passcode. Returns Map(requestedId -> card | null).
   */
  async getByIds(ids, onProgress) {
    const result = new Map()
    const missing = []
    for (const id of new Set(ids)) {
      const cached = getCachedCard(this.db, id)
      if (cached) result.set(id, cached)
      else missing.push(id)
    }

    let done = result.size
    const total = done + missing.length
    onProgress?.(done, total)

    const resolveFromResponse = (rows, wanted) => {
      for (const { card, ids } of rows) {
        for (const id of wanted) if (ids.includes(id)) result.set(id, card)
      }
    }

    // Batches of 50 via comma-separated ids; if a batch fails (one bad id
    // makes the API reject the whole request) fall back to one at a time.
    for (let i = 0; i < missing.length; i += 50) {
      const batch = missing.slice(i, i + 50)
      const rows = await this.queryWithIds({ id: batch.join(',') })
      resolveFromResponse(rows, batch)
      if (rows.length === 0) {
        await Promise.all(
          batch.map(async (id) => resolveFromResponse(await this.queryWithIds({ id: String(id) }), [id]))
        )
      }
      for (const id of batch) if (!result.has(id)) result.set(id, null)
      done += batch.length
      onProgress?.(done, total)
    }
    return result
  }

  /** Live search for the search bar: cached matches merged with API fname results. */
  async search(query, limit = 40) {
    const q = String(query || '').trim()
    if (q.length < 2) return { cards: [], offline: false }
    const key = normalizeName(q)
    let apiCards = this.searchMemo.get(key)
    let offline = false
    if (!apiCards) {
      try {
        apiCards = await this.query({ fname: q })
        if (this.searchMemo.size > 300) this.searchMemo.clear()
        this.searchMemo.set(key, apiCards)
      } catch (err) {
        if (!(err instanceof OfflineError)) throw err
        offline = true
        apiCards = []
      }
    }
    const byId = new Map()
    for (const c of searchCachedCards(this.db, q, limit)) byId.set(c.id, c)
    for (const c of apiCards) byId.set(c.id, c)
    const cards = rankSearchResults(q, [...byId.values()]).slice(0, limit)
    return { cards, offline }
  }

  /**
   * Resolves free text (a typed or OCR'd card name) to a card. Tries, in
   * order: exact cached name, exact API name, fuzzy API search, and fuzzy
   * searches on shorter prefixes / individual words for OCR-garbled text.
   * Returns {card, score} or null.
   */
  async matchName(text) {
    const name = String(text || '').trim()
    if (!name) return null
    const clean = name.replace(/(\.\.\.|…)\s*$/, '').trim()

    if (!isTruncated(name)) {
      const cached = getCachedCardByName(this.db, clean)
      if (cached) return { card: cached, score: 1 }
      const [exact] = await this.query({ name: clean })
      if (exact) return { card: exact, score: 1 }
    }

    const tried = new Set()
    let best = null
    const consider = async (q) => {
      const key = q.toLowerCase()
      if (q.length < 3 || tried.has(key)) return
      tried.add(key)
      const cards = await this.query({ fname: q })
      if (!cards.length) return
      const m = bestMatch(name, cards)
      if (m && (!best || m.score > best.score)) best = { card: m.card, score: m.score }
    }

    await consider(clean)
    if (best?.score >= 0.9) return best

    // OCR errors usually break the fname substring match, so retry with
    // shorter prefixes and with the longest individual words.
    const words = clean.split(/\s+/).filter(Boolean)
    const shortest = Math.max(1, words.length - 3)
    for (let n = words.length - 1; n >= shortest && !(best?.score >= 0.9); n--) {
      await consider(words.slice(0, n).join(' '))
    }
    const longest = [...words]
      .map((w) => w.replace(/[^A-Za-z0-9-]/g, ''))
      .filter((w) => w.length >= 5)
      .sort((a, b) => b.length - a.length)
      .slice(0, 2)
    for (const w of longest) {
      if (best?.score >= 0.9) break
      await consider(w)
    }

    return best && best.score >= MATCH_THRESHOLD ? best : null
  }
}

