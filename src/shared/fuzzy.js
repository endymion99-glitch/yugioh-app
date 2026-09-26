// String matching helpers for pairing OCR / typed names with real card names.

/** Lowercases and strips everything but letters, digits and single spaces. */
export function normalizeName(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function levenshtein(a, b) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = new Array(b.length + 1)
  let cur = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, cur] = [cur, prev]
  }
  return prev[b.length]
}

/** 0..1 similarity based on edit distance of normalized names. */
export function similarity(a, b) {
  const x = normalizeName(a)
  const y = normalizeName(b)
  if (!x || !y) return 0
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length)
}

/** True when the text was cut off with an ellipsis (long names on screen). */
export function isTruncated(text) {
  return /(\.\.\.|…)\s*$/.test(String(text || ''))
}

/**
 * Similarity of OCR text to a candidate card name. Truncated text ("Blue-Eyes
 * Alternative Wh...") is compared against the same-length prefix of the name.
 */
export function matchScore(text, candidate) {
  if (isTruncated(text)) {
    const t = normalizeName(text)
    const c = normalizeName(candidate)
    if (t.length >= 6 && c.length > t.length) {
      return 0.97 * (1 - levenshtein(t, c.slice(0, t.length)) / t.length)
    }
  }
  return similarity(text, candidate)
}

/** Picks the best-scoring candidate ({name}) for the text. */
export function bestMatch(text, candidates) {
  let best = null
  for (const c of candidates) {
    const score = matchScore(text, c.name)
    if (!best || score > best.score || (score === best.score && c.name.length < best.card.name.length)) {
      best = { card: c, score }
    }
  }
  return best
}

/** Ranks search results: exact, then prefix, then word-prefix, then others. */
export function rankSearchResults(query, cards) {
  const q = normalizeName(query)
  const rank = (name) => {
    const n = normalizeName(name)
    if (n === q) return 0
    if (n.startsWith(q)) return 1
    if (n.split(' ').some((w) => w.startsWith(q))) return 2
    return 3
  }
  return [...cards].sort(
    (a, b) => rank(a.name) - rank(b.name) || a.name.length - b.name.length || a.name.localeCompare(b.name)
  )
}
