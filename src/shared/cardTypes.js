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

/** Monster kinds the deck builder can filter by. */
export const MONSTER_KINDS = [
  { id: 'normal', label: 'Normal' },
  { id: 'effect', label: 'Effect' },
  { id: 'ritual', label: 'Ritual' },
  { id: 'fusion', label: 'Fusion' },
  { id: 'synchro', label: 'Synchro' },
  { id: 'xyz', label: 'Xyz' },
  { id: 'link', label: 'Link' },
  { id: 'pendulum', label: 'Pendulum' },
  { id: 'tuner', label: 'Tuner' },
  { id: 'flip', label: 'Flip' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'spirit', label: 'Spirit' },
  { id: 'toon', label: 'Toon' },
  { id: 'union', label: 'Union' }
]

/**
 * True when the card is a monster of that kind. "Effect" means an orange-frame
 * Main Deck effect monster (as on YGOprodeck), so Ritual and Extra Deck
 * monsters with effects only show under their own kinds.
 */
export function isMonsterKind(card, kind) {
  const category = cardCategory(card?.type)
  if (category !== 'monster' && category !== 'extra') return false
  const t = String(card.type).toLowerCase()
  if (kind === 'effect') {
    if (card.frameType) return card.frameType.startsWith('effect')
    return category === 'monster' && !t.includes('normal') && !t.includes('ritual') && !t.includes('token')
  }
  return t.includes(kind)
}

// A printed ATK/DEF, or null for "?" (stored as a negative number), Link
// monsters' missing DEF, and Spells/Traps.
const statOf = (card, stat) => (Number.isFinite(card[stat]) && card[stat] >= 0 ? card[stat] : null)

/**
 * Sort comparator for 'atk' or 'def', highest first. Ties are broken by the
 * other stat, then by name. Cards without a number for that stat go last,
 * in the usual monster/spell/trap order.
 */
export function compareByStat(stat) {
  const other = stat === 'atk' ? 'def' : 'atk'
  return (a, b) => {
    const sa = statOf(a, stat)
    const sb = statOf(b, stat)
    if (sa === null || sb === null) {
      if (sa !== sb) return sa === null ? 1 : -1
      return compareCards(a, b)
    }
    return sb - sa || (statOf(b, other) ?? -1) - (statOf(a, other) ?? -1) || a.name.localeCompare(b.name)
  }
}

/** Monster levels the deck builder can filter by. */
export const LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

/**
 * Sort comparator by level, 'desc' (highest first) or 'asc'. Equal levels
 * compare as 0 so another comparator can break the tie; cards without a
 * level go last.
 */
export function compareByLevel(direction) {
  return (a, b) => {
    const la = Number.isFinite(a.level) ? a.level : null
    const lb = Number.isFinite(b.level) ? b.level : null
    if (la === null || lb === null) return la === lb ? 0 : la === null ? 1 : -1
    return direction === 'asc' ? la - lb : lb - la
  }
}

export const CARD_IMAGE_CDN = 'https://images.ygoprodeck.com/images/cards'
export const CARD_IMAGE_SMALL_CDN = 'https://images.ygoprodeck.com/images/cards_small'
