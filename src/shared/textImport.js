// .txt import: one card name per line; repeated lines are extra copies.
// A leading "3x " / "3 x " quantity prefix is also accepted as a convenience.

const QTY_PREFIX = /^(\d{1,2})\s*[x×]\s+(.+)$/i

/**
 * Returns [{name, quantity}] in first-seen order. Lines differing only in
 * case or surrounding whitespace count as the same card.
 */
export function parseCardList(text) {
  const byKey = new Map()
  for (const raw of String(text).split(/\r?\n/)) {
    let line = raw.replace(/^﻿/, '').trim()
    if (!line || line.startsWith('#') || line.startsWith('//')) continue

    let quantity = 1
    const m = line.match(QTY_PREFIX)
    if (m) {
      quantity = Number(m[1])
      line = m[2].trim()
    }
    if (!line || quantity <= 0) continue

    const key = line.toLowerCase().replace(/\s+/g, ' ')
    const entry = byKey.get(key)
    if (entry) entry.quantity += quantity
    else byKey.set(key, { name: line.replace(/\s+/g, ' '), quantity })
  }
  return [...byKey.values()]
}
