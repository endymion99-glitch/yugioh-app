import { describe, it, expect } from 'vitest'
import { isExtraDeckType, defaultSectionFor, compareCards, compareByStat, compareByLevel, isMonsterKind } from '../src/shared/cardTypes.js'
import { validateDeck, availableCopies } from '../src/shared/deckRules.js'
import { parseYdk, buildYdk } from '../src/shared/ydk.js'
import { parseCardList } from '../src/shared/textImport.js'
import { similarity, matchScore, bestMatch, rankSearchResults } from '../src/shared/fuzzy.js'

describe('cardTypes', () => {
  it.each([
    ['Fusion Monster', true],
    ['Synchro Tuner Monster', true],
    ['XYZ Monster', true],
    ['Link Monster', true],
    ['Pendulum Effect Fusion Monster', true],
    ['Synchro Pendulum Effect Monster', true],
    ['Effect Monster', false],
    ['Ritual Effect Monster', false],
    ['Spell Card', false],
    ['Trap Card', false],
    [null, false]
  ])('isExtraDeckType(%s) = %s', (type, expected) => {
    expect(isExtraDeckType(type)).toBe(expected)
  })

  it('routes cards to main or extra', () => {
    expect(defaultSectionFor({ type: 'Link Monster' })).toBe('extra')
    expect(defaultSectionFor({ type: 'Normal Monster' })).toBe('main')
  })

  it('sorts monsters, spells, traps', () => {
    const sorted = [
      { name: 'Mirror Force', type: 'Trap Card' },
      { name: 'Pot of Greed', type: 'Spell Card' },
      { name: 'Kuriboh', type: 'Effect Monster' }
    ].sort(compareCards)
    expect(sorted.map((c) => c.name)).toEqual(['Kuriboh', 'Pot of Greed', 'Mirror Force'])
  })

  describe('monster kinds', () => {
    const card = (type, frameType) => ({ type, frameType })
    it.each([
      [card('Effect Monster', 'effect'), 'effect', true],
      [card('Tuner Monster', 'effect'), 'effect', true], // effect monster despite the type name
      [card('Tuner Monster', 'effect'), 'tuner', true],
      [card('Gemini Monster'), 'effect', true], // no frameType cached: guessed from the type
      [card('Normal Monster', 'normal'), 'effect', false],
      [card('Normal Monster', 'normal'), 'normal', true],
      [card('Ritual Effect Monster', 'ritual'), 'effect', false],
      [card('Ritual Effect Monster', 'ritual'), 'ritual', true],
      [card('Fusion Monster', 'fusion'), 'effect', false],
      [card('Fusion Monster', 'fusion'), 'fusion', true],
      [card('XYZ Pendulum Effect Monster', 'xyz_pendulum'), 'xyz', true],
      [card('XYZ Pendulum Effect Monster', 'xyz_pendulum'), 'pendulum', true],
      [card('Pendulum Effect Monster', 'effect_pendulum'), 'effect', true],
      [card('Spell Card', 'spell'), 'ritual', false], // Ritual Spells are not monsters
      [card('Trap Card', 'trap'), 'effect', false]
    ])('%o is %s: %s', (c, kind, expected) => {
      expect(isMonsterKind(c, kind)).toBe(expected)
    })
  })

  describe('sorting by level', () => {
    const cards = [
      { name: 'Pot of Greed', type: 'Spell Card', level: null },
      { name: 'Kuriboh', type: 'Effect Monster', level: 1, atk: 300 },
      { name: 'Dark Magician', type: 'Normal Monster', level: 7, atk: 2500 },
      { name: 'Celtic Guardian', type: 'Normal Monster', level: 4, atk: 1400 },
      { name: 'Blue-Eyes White Dragon', type: 'Normal Monster', level: 8, atk: 3000 },
      { name: 'Red-Eyes Black Dragon', type: 'Normal Monster', level: 7, atk: 2400 },
      { name: 'Axe Raider', type: 'Normal Monster', level: 4, atk: 1700 }
    ]
    const sorted = (direction, tieBreak = compareCards) =>
      [...cards].sort((a, b) => compareByLevel(direction)(a, b) || tieBreak(a, b)).map((c) => c.name)

    it('puts the highest level first, cards without a level last', () => {
      expect(sorted('desc')).toEqual([
        'Blue-Eyes White Dragon',
        'Dark Magician',
        'Red-Eyes Black Dragon',
        'Axe Raider',
        'Celtic Guardian',
        'Kuriboh',
        'Pot of Greed'
      ])
    })

    it('can go lowest first, with the other sort breaking ties', () => {
      expect(sorted('asc', compareByStat('atk'))).toEqual([
        'Kuriboh',
        'Axe Raider', // level 4, higher ATK than Celtic Guardian
        'Celtic Guardian',
        'Dark Magician',
        'Red-Eyes Black Dragon',
        'Blue-Eyes White Dragon',
        'Pot of Greed'
      ])
    })
  })

  describe('sorting by ATK / DEF', () => {
    const cards = [
      { name: 'Pot of Greed', type: 'Spell Card', atk: null, def: null },
      { name: 'Kuriboh', type: 'Effect Monster', atk: 300, def: 200 },
      { name: 'Blue-Eyes White Dragon', type: 'Normal Monster', atk: 3000, def: 2500 },
      { name: 'Mirror Force', type: 'Trap Card', atk: null, def: null },
      { name: 'Decode Talker', type: 'Link Monster', atk: 2300, def: null, linkval: 3 },
      { name: 'Dark Magician', type: 'Normal Monster', atk: 2500, def: 2100 },
      { name: 'Summoned Skull', type: 'Normal Monster', atk: 2500, def: 1200 },
      { name: 'Question Mark', type: 'Effect Monster', atk: -1, def: 1000 }
    ]
    const names = (stat) => [...cards].sort(compareByStat(stat)).map((c) => c.name)

    it('puts the highest ATK first, then cards without an ATK', () => {
      expect(names('atk')).toEqual([
        'Blue-Eyes White Dragon',
        'Dark Magician', // same ATK as Summoned Skull, higher DEF
        'Summoned Skull',
        'Decode Talker',
        'Kuriboh',
        'Question Mark',
        'Pot of Greed',
        'Mirror Force'
      ])
    })

    it('puts the highest DEF first; Link monsters have none', () => {
      expect(names('def')).toEqual([
        'Blue-Eyes White Dragon',
        'Dark Magician',
        'Summoned Skull',
        'Question Mark',
        'Kuriboh',
        'Decode Talker',
        'Pot of Greed',
        'Mirror Force'
      ])
    })
  })
})

describe('validateDeck', () => {
  const filler = (n, section = 'main') =>
    Array.from({ length: n }, (_, i) => ({ cardId: 1000 + i, section, quantity: 1 }))

  it('accepts a 40-card deck', () => {
    const r = validateDeck(filler(40))
    expect(r.errors).toEqual([])
    expect(r.canSave).toBe(true)
    expect(r.counts).toEqual({ main: 40, extra: 0, side: 0 })
  })

  it('reports size limits', () => {
    const codes = (entries) => validateDeck(entries).errors.map((e) => e.code)
    expect(codes(filler(39))).toContain('main-too-small')
    expect(codes(filler(61))).toContain('main-too-large')
    expect(codes([...filler(40), ...filler(16, 'extra').map((e) => ({ ...e, cardId: e.cardId + 500 }))])).toContain(
      'extra-too-large'
    )
    expect(codes([...filler(40), ...filler(16, 'side').map((e) => ({ ...e, cardId: e.cardId + 500 }))])).toContain(
      'side-too-large'
    )
  })

  it('limits copies to 3 across all sections', () => {
    const entries = [
      ...filler(38),
      { cardId: 1, name: 'Pot of Greed', section: 'main', quantity: 3 },
      { cardId: 1, name: 'Pot of Greed', section: 'side', quantity: 1 }
    ]
    const err = validateDeck(entries).errors.find((e) => e.code === 'too-many-copies')
    expect(err).toMatchObject({ cardId: 1 })
    expect(err.message).toContain('Pot of Greed')
  })

  it('checks ownership against the collection', () => {
    const owned = new Map([[1, 2]])
    const entries = [...filler(38), { cardId: 1, section: 'main', quantity: 3 }]
    const codes = validateDeck(entries, owned).errors.map((e) => e.code)
    expect(codes).toContain('not-owned')
  })

  it('flags cards in the wrong section', () => {
    const entries = [...filler(40), { cardId: 9, type: 'Link Monster', section: 'main', quantity: 1 }]
    expect(validateDeck(entries).errors.map((e) => e.code)).toContain('wrong-section')
  })

  it('computes available copies', () => {
    const owned = new Map([[1, 3]])
    const entries = [
      { cardId: 1, section: 'main', quantity: 2 },
      { cardId: 1, section: 'side', quantity: 1 }
    ]
    expect(availableCopies(1, entries, owned)).toBe(0)
    expect(availableCopies(1, [], owned)).toBe(3)
    expect(availableCopies(2, [], owned)).toBe(0)
  })
})

describe('ydk', () => {
  const sample = `#created by someone
#main
89631139
46986414
89631139
#extra
27548199
!side
44519536
`

  it('parses sections and counts duplicates', () => {
    const { sections, all } = parseYdk(sample)
    expect(sections.main.get(89631139)).toBe(2)
    expect(sections.extra.get(27548199)).toBe(1)
    expect(sections.side.get(44519536)).toBe(1)
    expect([...all.entries()]).toEqual([
      [89631139, 2],
      [46986414, 1],
      [27548199, 1],
      [44519536, 1]
    ])
  })

  it('handles CRLF and junk lines', () => {
    const { all } = parseYdk('#main\r\n123\r\n  456  \r\nnot a card\r\n')
    expect([...all.keys()]).toEqual([123, 456])
  })

  it('round-trips through buildYdk', () => {
    const text = buildYdk([
      { cardId: 89631139, section: 'main', quantity: 2 },
      { cardId: 27548199, section: 'extra', quantity: 1 },
      { cardId: 44519536, section: 'side', quantity: 1 }
    ])
    expect(text).toBe(
      '#created by YGO Collection Manager\n#main\n89631139\n89631139\n#extra\n27548199\n!side\n44519536\n'
    )
    const { sections } = parseYdk(text)
    expect(sections.main.get(89631139)).toBe(2)
  })
})

describe('parseCardList', () => {
  it('counts duplicate lines as copies', () => {
    const list = parseCardList('Dark Magician\nDark Magician\n\nPot of Greed\ndark magician \n')
    expect(list).toEqual([
      { name: 'Dark Magician', quantity: 3 },
      { name: 'Pot of Greed', quantity: 1 }
    ])
  })

  it('accepts "3x Name" prefixes but keeps numeric card names', () => {
    const list = parseCardList('3x Mirror Force\n7 Colored Fish\nNumber 39: Utopia\n# comment')
    expect(list).toEqual([
      { name: 'Mirror Force', quantity: 3 },
      { name: '7 Colored Fish', quantity: 1 },
      { name: 'Number 39: Utopia', quantity: 1 }
    ])
  })
})

describe('fuzzy', () => {
  it('scores OCR noise highly', () => {
    expect(similarity('Blue-Eyes White Dragon', 'Blue-Eyes White Dragon')).toBe(1)
    expect(similarity('BIue-Eyes Whlte Dragon', 'Blue-Eyes White Dragon')).toBeGreaterThan(0.85)
    expect(similarity('Pot of Greed', 'Mirror Force')).toBeLessThan(0.4)
  })

  it('matches truncated names against prefixes', () => {
    expect(matchScore('Blue-Eyes Alternative Wh...', 'Blue-Eyes Alternative White Dragon')).toBeGreaterThan(0.9)
  })

  it('prefers the closest candidate', () => {
    const m = bestMatch('Dark Magiclan', [
      { name: 'Dark Magician Girl' },
      { name: 'Dark Magician' },
      { name: 'Dark Magic Attack' }
    ])
    expect(m.card.name).toBe('Dark Magician')
  })

  it('ranks exact and prefix results first', () => {
    const ranked = rankSearchResults('dark magician', [
      { name: 'The Dark Magicians' },
      { name: 'Dark Magician Girl' },
      { name: 'Dark Magician' }
    ])
    expect(ranked.map((c) => c.name)).toEqual(['Dark Magician', 'Dark Magician Girl', 'The Dark Magicians'])
  })
})
