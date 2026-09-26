// Card-type helpers shared by the main process and the renderer.

const EXTRA_DECK_MARKERS = ['fusion', 'synchro', 'xyz', 'link']

/** True when a YGOprodeck `type` string belongs in the Extra Deck. */
export function isExtraDeckType(type) {
  if (!type) return false
  const t = String(type).toLowerCase()
  return EXTRA_DECK_MARKERS.some((m) => t.includes(m))
}

/** The deck section a card goes to when added without an explicit choice. */
export function defaultSectionFor(card) {
  return isExtraDeckType(card?.type) ? 'extra' : 'main'
}

/** Coarse category used for colour-coding and sorting. */
export function cardCategory(type) {
  const t = String(type || '').toLowerCase()
  if (t.includes('spell')) return 'spell'
  if (t.includes('trap')) return 'trap'
  if (isExtraDeckType(t)) return 'extra'
  if (t.includes('monster') || t.includes('token')) return 'monster'
  return 'other'
}

const CATEGORY_ORDER = { monster: 0, extra: 0, spell: 1, trap: 2, other: 3 }

/** Sort comparator: monsters, then spells, then traps; alphabetical within. */
export function compareCards(a, b) {
  const ca = CATEGORY_ORDER[cardCategory(a.type)]
  const cb = CATEGORY_ORDER[cardCategory(b.type)]
  if (ca !== cb) return ca - cb
  return a.name.localeCompare(b.name)
}

export const CARD_IMAGE_CDN = 'https://images.ygoprodeck.com/images/cards'
export const CARD_IMAGE_SMALL_CDN = 'https://images.ygoprodeck.com/images/cards_small'
