// Filtering and sorting of the player's cards, shared by the Collection page
// and the deck builder.

import { cardCategory, compareByLevel, compareByStat, compareCards, isMonster, isMonsterKind } from './cardTypes.js'

const byName = (a, b) => a.name.localeCompare(b.name)

export const SORTS = {
  name: { label: 'Sort: Name', compare: byName },
  type: { label: 'Sort: Type', compare: compareCards },
  atk: { label: 'Sort: ATK (high → low)', compare: compareByStat('atk') },
  def: { label: 'Sort: DEF (high → low)', compare: compareByStat('def') },
  quantity: { label: 'Sort: Copies', compare: (a, b) => b.quantity - a.quantity || byName(a, b) }
}

/**
 * query: name search; category: all | monster | extra | spell | trap;
 * kind: MONSTER_KINDS id; attribute / race: one value each; levels: list of
 * levels (or ranks) to show; levelSort: '' | 'desc' | 'asc'.
 */
export const EMPTY_FILTERS = {
  query: '',
  category: 'all',
  kind: '',
  attribute: '',
  race: '',
  levels: [],
  levelSort: ''
}

/** Tabs that show the Attribute and Type filters. */
export const hasMonsterFilters = (category) => category === 'all' || category === 'monster' || category === 'extra'

/** Tabs that show the level controls (ranks for Xyz on the Extra tab). */
export const hasLevelFilters = (category) => category === 'monster' || category === 'extra'

function matches(card, f, skip) {
  const q = f.query.trim().toLowerCase()
  if (q && !card.name.toLowerCase().includes(q)) return false
  if (f.category !== 'all' && cardCategory(card.type) !== f.category) return false
  if (f.kind && !isMonsterKind(card, f.kind)) return false
  if (skip !== 'attribute' && f.attribute && !(isMonster(card) && card.attribute === f.attribute)) return false
  if (skip !== 'race' && f.race && !(isMonster(card) && card.race === f.race)) return false
  if (skip !== 'level' && hasLevelFilters(f.category) && f.levels.length && !f.levels.includes(card.level)) return false
  return true
}

/** The cards that pass the filters, sorted. */
export function applyFilters(cards, f, sort) {
  const base = SORTS[sort].compare
  const byLevel = hasLevelFilters(f.category) && f.levelSort ? compareByLevel(f.levelSort) : null
  return cards.filter((c) => matches(c, f)).sort((a, b) => (byLevel ? byLevel(a, b) : 0) || base(a, b))
}

/**
 * For each Attribute, Type and level: how many cards would show if it were
 * picked, with every other filter left as it is.
 */
export function filterCounts(cards, f) {
  const counts = { attribute: new Map(), race: new Map(), level: new Map() }
  const add = (map, key) => map.set(key, (map.get(key) || 0) + 1)
  for (const c of cards) {
    if (!isMonster(c)) continue
    if (matches(c, f, 'attribute')) add(counts.attribute, c.attribute)
    if (matches(c, f, 'race')) add(counts.race, c.race)
    if (Number.isFinite(c.level) && matches(c, f, 'level')) add(counts.level, c.level)
  }
  return counts
}

/** True when any filter that can hide cards is in use. */
export function isFiltering(f) {
  return (
    !!f.query.trim() ||
    f.category !== 'all' ||
    !!f.kind ||
    !!f.attribute ||
    !!f.race ||
    (hasLevelFilters(f.category) && f.levels.length > 0)
  )
}

/** Applies a change, keeping the filters consistent with the chosen tab. */
export function updateFilters(f, patch) {
  const next = { ...f, ...patch }
  if (patch.category === 'spell' || patch.category === 'trap') {
    // Spells and Traps have none of the monster properties.
    Object.assign(next, { kind: '', attribute: '', race: '' })
  } else if ((patch.kind || patch.attribute || patch.race) && (f.category === 'spell' || f.category === 'trap')) {
    next.category = 'all'
  }
  return next
}

/** Clears every filter; the level order is a sort, so it stays. */
export const resetFilters = (f) => ({ ...EMPTY_FILTERS, levelSort: f.levelSort })

/** ATK/DEF as printed: '?' for unknown, '–' for none. */
export const statText = (v) => (v === null || v === undefined ? '–' : v < 0 ? '?' : v)

/** Short label for a monster's level, Xyz rank or Link rating. */
export function levelBadge(card) {
  const t = String(card.type || '').toLowerCase()
  if (t.includes('link')) return card.linkval != null ? `LINK-${card.linkval}` : null
  if (!Number.isFinite(card.level)) return null
  return t.includes('xyz') ? `R${card.level}` : `★${card.level}`
}
