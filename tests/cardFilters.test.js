import { describe, it, expect } from 'vitest'
import {
  EMPTY_FILTERS,
  applyFilters,
  filterCounts,
  isFiltering,
  levelBadge,
  resetFilters,
  updateFilters
} from '../src/shared/cardFilters.js'

const m = (name, type, attribute, race, level, atk, extra = {}) => ({ name, type, attribute, race, level, atk, ...extra })
const CARDS = [
  m('Dark Magician', 'Normal Monster', 'DARK', 'Spellcaster', 7, 2500),
  m('Dark Magician Girl', 'Effect Monster', 'DARK', 'Spellcaster', 6, 2000),
  m('Mystical Elf', 'Normal Monster', 'LIGHT', 'Spellcaster', 4, 800),
  m('Red-Eyes Black Dragon', 'Normal Monster', 'DARK', 'Dragon', 7, 2400),
  m('Kuriboh', 'Effect Monster', 'DARK', 'Fiend', 1, 300),
  m('Number 39: Utopia', 'XYZ Monster', 'LIGHT', 'Warrior', 4, 2500),
  m('Stardust Dragon', 'Synchro Monster', 'WIND', 'Dragon', 8, 2500),
  m('Borreload Dragon', 'Link Monster', 'DARK', 'Dragon', null, 3000, { linkval: 4 }),
  { name: 'Pot of Greed', type: 'Spell Card', race: 'Normal' },
  { name: 'Mirror Force', type: 'Trap Card', race: 'Normal' }
]
const names = (f, sort = 'name') => applyFilters(CARDS, { ...EMPTY_FILTERS, ...f }, sort).map((c) => c.name)

describe('applyFilters', () => {
  it('combines Attribute and Type', () => {
    expect(names({ attribute: 'DARK' })).toHaveLength(5)
    expect(names({ race: 'Spellcaster' })).toEqual(['Dark Magician', 'Dark Magician Girl', 'Mystical Elf'])
    expect(names({ attribute: 'DARK', race: 'Spellcaster' })).toEqual(['Dark Magician', 'Dark Magician Girl'])
  })

  it('filters by level on the Monsters tab only', () => {
    expect(names({ category: 'monster', levels: [6, 7] })).toEqual([
      'Dark Magician',
      'Dark Magician Girl',
      'Red-Eyes Black Dragon'
    ])
    // Hidden on the All tab, so it doesn't apply there.
    expect(names({ category: 'all', levels: [6, 7] })).toHaveLength(CARDS.length)
  })

  it('matches Xyz ranks with the same numbers on the Extra tab', () => {
    expect(names({ category: 'extra', levels: [4] })).toEqual(['Number 39: Utopia'])
    expect(names({ category: 'extra', levelSort: 'desc' })).toEqual([
      'Stardust Dragon',
      'Number 39: Utopia',
      'Borreload Dragon' // Link monsters have no level or rank
    ])
  })

  it('sorts by level, then by the main sort', () => {
    expect(names({ category: 'monster', levelSort: 'desc' }, 'atk')).toEqual([
      'Dark Magician',
      'Red-Eyes Black Dragon',
      'Dark Magician Girl',
      'Mystical Elf',
      'Kuriboh'
    ])
  })
})

describe('filterCounts', () => {
  it('counts what each option would show, given the other filters', () => {
    const counts = filterCounts(CARDS, { ...EMPTY_FILTERS, attribute: 'DARK' })
    expect(counts.race.get('Spellcaster')).toBe(2)
    expect(counts.race.get('Dragon')).toBe(2)
    expect(counts.race.get('Warrior')).toBeUndefined()
    // The Attribute counts ignore the Attribute filter itself.
    expect(counts.attribute.get('LIGHT')).toBe(2)
  })
})

describe('filter state', () => {
  it('clears monster filters when switching to Spells or Traps', () => {
    const f = updateFilters({ ...EMPTY_FILTERS, kind: 'effect', attribute: 'DARK', race: 'Fiend' }, { category: 'spell' })
    expect(f).toMatchObject({ category: 'spell', kind: '', attribute: '', race: '' })
  })

  it('switches back to All when a monster filter is picked on Spells', () => {
    expect(updateFilters({ ...EMPTY_FILTERS, category: 'trap' }, { attribute: 'DARK' }).category).toBe('all')
  })

  it('knows when cards are being hidden, and resets everything but the level order', () => {
    expect(isFiltering(EMPTY_FILTERS)).toBe(false)
    expect(isFiltering({ ...EMPTY_FILTERS, query: ' ' })).toBe(false)
    expect(isFiltering({ ...EMPTY_FILTERS, race: 'Fiend' })).toBe(true)
    const f = { ...EMPTY_FILTERS, category: 'monster', levels: [4], levelSort: 'asc', query: 'dark' }
    expect(resetFilters(f)).toEqual({ ...EMPTY_FILTERS, levelSort: 'asc' })
  })
})

it('labels levels, ranks and link ratings', () => {
  expect(CARDS.slice(4, 8).map(levelBadge)).toEqual(['★1', 'R4', '★8', 'LINK-4'])
  expect(levelBadge(CARDS[8])).toBeNull()
})
