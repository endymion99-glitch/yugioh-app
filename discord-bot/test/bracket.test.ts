import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STAGE_FORMATS,
  SLOTS,
  applyResult,
  claimResult,
  computePlacements,
  confirmResult,
  createBracket,
  disputeResult,
  feederCode,
  isComplete,
  parseScore,
  playableMatches,
  previewResult,
  resolveBracket,
  swapPlayer,
  validateScore,
  type MatchState,
  type Pairs,
  type Slot
} from '../src/logic/bracket'
import { TournamentError } from '../src/logic/errors'
import { createTestDb } from './helpers/d1'

// Players 1..8; Round 1 is 1v2, 3v4, 5v6, 7v8.
const PAIRS: Pairs = [[1, 2], [3, 4], [5, 6], [7, 8]]
const fresh = () => createBracket(PAIRS, DEFAULT_STAGE_FORMATS)
const get = (ms: MatchState[], slot: Slot) => ms.find((m) => m.slot === slot)!

/** Confirms a win for `winner` in `slot` with the minimum valid score. */
function win(ms: MatchState[], slot: Slot, winner: number) {
  const bo3 = get(ms, slot).bestOf === 3
  return applyResult(ms, slot, { winner, winnerGames: bo3 ? 2 : 1, loserGames: 0 })
}

/** Plays a whole tournament where the lower id always wins. */
function playAll(start = fresh()) {
  let ms = start
  for (const slot of ['M1', 'M2', 'M3', 'M4', 'WA', 'WB', 'LA', 'LB', 'P1', 'P3', 'P5', 'P7'] as Slot[]) {
    const m = get(ms, slot)
    ms = win(ms, slot, Math.min(m.player1!, m.player2!)).matches
  }
  return ms
}

describe('createBracket', () => {
  it('creates 12 matches: Round 1 ready, the rest waiting', () => {
    const ms = fresh()
    expect(ms).toHaveLength(12)
    expect(ms.filter((m) => m.status === 'ready').map((m) => m.slot)).toEqual(['M1', 'M2', 'M3', 'M4'])
    expect(get(ms, 'M3')).toMatchObject({ player1: 5, player2: 6 })
    expect(get(ms, 'WA')).toMatchObject({ player1: null, player2: null, status: 'waiting' })
  })

  it('uses Bo1 for every stage by default, except Bo3 for the 1st/2nd match', () => {
    const ms = fresh()
    for (const m of ms) expect(m.bestOf).toBe(m.slot === 'P1' ? 3 : 1)
  })

  it('takes each match format from its stage', () => {
    const ms = createBracket(PAIRS, { ...DEFAULT_STAGE_FORMATS, P3: 3, WS: 3 })
    expect(ms.filter((m) => m.bestOf === 3).map((m) => m.slot)).toEqual(['WA', 'WB', 'P1', 'P3'])
  })

  it('rejects duplicate players', () => {
    expect(() => createBracket([[1, 2], [3, 4], [5, 6], [7, 1]], DEFAULT_STAGE_FORMATS)).toThrow(TournamentError)
  })

  it('agrees with the default formats seeded in the database', async () => {
    const db = createTestDb()
    const { results } = await db.prepare('SELECT stage, best_of FROM stage_formats').all<{ stage: string; best_of: number }>()
    expect(Object.fromEntries(results.map((r) => [r.stage, r.best_of]))).toEqual(DEFAULT_STAGE_FORMATS)
  })
})

describe('feeders', () => {
  it('wires the bracket as in the spec', () => {
    const codes = Object.fromEntries(
      Object.entries(SLOTS)
        .filter(([, s]) => s.feeders)
        .map(([slot, s]) => [slot, s.feeders!.map(feederCode).join(' v ')])
    )
    expect(codes).toEqual({
      WA: 'W:M1 v W:M2',
      WB: 'W:M3 v W:M4',
      LA: 'L:M1 v L:M2',
      LB: 'L:M3 v L:M4',
      P1: 'W:WA v W:WB',
      P3: 'L:WA v L:WB',
      P5: 'W:LA v W:LB',
      P7: 'L:LA v L:LB'
    })
  })

  it('makes a Round 2 match playable as soon as both its feeders are confirmed', () => {
    let r = win(fresh(), 'M1', 1)
    expect(r.becameReady).toEqual([])
    expect(get(r.matches, 'WA')).toMatchObject({ player1: 1, player2: null, status: 'waiting' })
    expect(get(r.matches, 'LA')).toMatchObject({ player1: 2, player2: null, status: 'waiting' })

    r = win(r.matches, 'M2', 4)
    expect(r.becameReady.sort()).toEqual(['LA', 'WA'])
    expect(get(r.matches, 'WA')).toMatchObject({ player1: 1, player2: 4, status: 'ready' })
    expect(get(r.matches, 'LA')).toMatchObject({ player1: 2, player2: 3, status: 'ready' })
    // M3 and M4 haven't been played, but WA/LA don't need them.
    expect(get(r.matches, 'WB').status).toBe('waiting')
  })

  it('fills Round 3 from Round 2 winners and losers', () => {
    let ms = fresh()
    ms = win(ms, 'M1', 1).matches // L: 2
    ms = win(ms, 'M2', 3).matches // L: 4
    ms = win(ms, 'M3', 6).matches // L: 5
    ms = win(ms, 'M4', 8).matches // L: 7
    ms = win(ms, 'WA', 3).matches // WA = 1 v 3
    ms = win(ms, 'WB', 6).matches // WB = 6 v 8
    ms = win(ms, 'LA', 2).matches // LA = 2 v 4
    const r = win(ms, 'LB', 7) //    LB = 5 v 7
    ms = r.matches
    expect(get(ms, 'P1')).toMatchObject({ player1: 3, player2: 6 })
    expect(get(ms, 'P3')).toMatchObject({ player1: 1, player2: 8 })
    expect(get(ms, 'P5')).toMatchObject({ player1: 2, player2: 7 })
    expect(get(ms, 'P7')).toMatchObject({ player1: 4, player2: 5 })
    expect(r.becameReady.sort()).toEqual(['P5', 'P7'])
  })
})

describe('placements', () => {
  it('decides every place 1st to 8th', () => {
    const ms = playAll()
    expect(isComplete(ms)).toBe(true)
    // Lower id always wins: R1 winners 1,3,5,7; WA 1>3, WB 5>7; LA 2>4, LB 6>8.
    // P1: 1 v 5 -> 1st 1, 2nd 5. P3: 3 v 7. P5: 2 v 6. P7: 4 v 8.
    expect(computePlacements(ms)).toEqual([
      { place: 1, playerId: 1 },
      { place: 2, playerId: 5 },
      { place: 3, playerId: 3 },
      { place: 4, playerId: 7 },
      { place: 5, playerId: 2 },
      { place: 6, playerId: 6 },
      { place: 7, playerId: 4 },
      { place: 8, playerId: 8 }
    ])
  })

  it('refuses to compute placements before Round 3 is done', () => {
    expect(() => computePlacements(fresh())).toThrow(/no confirmed result/)
    expect(isComplete(fresh())).toBe(false)
  })
})

describe('scores', () => {
  it('accepts only 1-0 for Bo1', () => {
    expect(() => validateScore(1, 1, 0)).not.toThrow()
    expect(() => validateScore(1, 2, 0)).toThrow(/Best of 1/)
    expect(() => validateScore(1, 2, 1)).toThrow(TournamentError)
  })

  it('accepts only 2-0 and 2-1 for Bo3', () => {
    expect(() => validateScore(3, 2, 0)).not.toThrow()
    expect(() => validateScore(3, 2, 1)).not.toThrow()
    expect(() => validateScore(3, 1, 0)).toThrow(/2-0 or 2-1/)
    expect(() => validateScore(3, 2, 2)).toThrow(TournamentError)
    expect(() => validateScore(3, 3, 0)).toThrow(TournamentError)
  })

  it('parses score choices, with Bo1 allowed to leave it out', () => {
    expect(parseScore(1)).toEqual({ winnerGames: 1, loserGames: 0 })
    expect(parseScore(1, '1-0')).toEqual({ winnerGames: 1, loserGames: 0 })
    expect(parseScore(3, '2-1')).toEqual({ winnerGames: 2, loserGames: 1 })
    expect(parseScore(3, '1-2')).toEqual({ winnerGames: 2, loserGames: 1 })
    expect(() => parseScore(3)).toThrow(/include the score/)
    expect(() => parseScore(1, '2-0')).toThrow(/Best of 1/)
    expect(() => parseScore(3, 'two-one')).toThrow(/isn't a score/)
  })

  it('stores the score from each player’s side and rejects outsiders as winner', () => {
    let ms = fresh()
    for (const [slot, w] of [['M1', 1], ['M2', 3], ['M3', 5], ['M4', 7], ['WA', 1], ['WB', 5]] as const) {
      ms = win(ms, slot, w).matches
    }
    const r = applyResult(ms, 'P1', { winner: 5, winnerGames: 2, loserGames: 1 })
    expect(get(r.matches, 'P1')).toMatchObject({ player1: 1, player2: 5, winner: 5, scoreP1: 1, scoreP2: 2 })
    expect(() => applyResult(ms, 'P1', { winner: 2, winnerGames: 2, loserGames: 0 })).toThrow(/one of the two players/)
    expect(() => applyResult(ms, 'P1', { winner: 1, winnerGames: 1, loserGames: 0 })).toThrow(/Best of 3/)
  })

  it('refuses a result for a match whose players are not known yet', () => {
    expect(() => win(fresh(), 'WA', 1)).toThrow(/can't be played yet/)
  })
})

describe('report, confirm and dispute', () => {
  it('a claim is pending until confirmed, and only then advances the bracket', () => {
    let ms = claimResult(fresh(), 'M1', { winner: 2, winnerGames: 1, loserGames: 0 })
    expect(get(ms, 'M1')).toMatchObject({ status: 'pending', winner: 2 })
    expect(get(ms, 'WA').player1).toBeNull()

    const r = confirmResult(ms, 'M1')
    expect(get(r.matches, 'M1').status).toBe('confirmed')
    expect(get(r.matches, 'WA').player1).toBe(2)
    expect(get(r.matches, 'LA').player1).toBe(1)
  })

  it('a new claim replaces a pending one; disputed claims need an admin', () => {
    let ms = claimResult(fresh(), 'M1', { winner: 2, winnerGames: 1, loserGames: 0 })
    ms = claimResult(ms, 'M1', { winner: 1, winnerGames: 1, loserGames: 0 })
    expect(get(ms, 'M1').winner).toBe(1)

    ms = disputeResult(ms, 'M1')
    expect(get(ms, 'M1').status).toBe('disputed')
    expect(() => claimResult(ms, 'M1', { winner: 1, winnerGames: 1, loserGames: 0 })).toThrow(/disputed/)
    expect(() => confirmResult(ms, 'M1')).toThrow(/no reported result/)

    // An admin override settles it.
    const r = applyResult(ms, 'M1', { winner: 2, winnerGames: 1, loserGames: 0 })
    expect(get(r.matches, 'M1')).toMatchObject({ status: 'confirmed', winner: 2 })
  })

  it('cannot report or dispute a confirmed match', () => {
    const ms = win(fresh(), 'M1', 1).matches
    expect(() => claimResult(ms, 'M1', { winner: 2, winnerGames: 1, loserGames: 0 })).toThrow(/already has a confirmed/)
    expect(() => disputeResult(ms, 'M1')).toThrow(TournamentError)
  })

  it('lists playable matches, including ones waiting for confirmation', () => {
    let ms = win(fresh(), 'M1', 1).matches
    ms = claimResult(ms, 'M2', { winner: 3, winnerGames: 1, loserGames: 0 })
    expect(playableMatches(ms).map((m) => m.slot)).toEqual(['M2', 'M3', 'M4'])
  })
})

describe('corrections and recalculation', () => {
  it('changing only the score keeps every later result', () => {
    // Winners' semis set to Bo3, so WA's 2-0 can be edited to 2-1.
    const ms = playAll(createBracket(PAIRS, { ...DEFAULT_STAGE_FORMATS, WS: 3 }))
    const before = ms
    const r = applyResult(ms, 'WA', { winner: get(ms, 'WA').winner!, winnerGames: 2, loserGames: 1 })
    expect(r.reset).toEqual([])
    expect(isComplete(r.matches)).toBe(true)
    expect(computePlacements(r.matches)).toEqual(computePlacements(before))
  })

  it('changing a Round 1 winner resets the 6 later matches that depended on it', () => {
    const ms = playAll()
    const r = applyResult(ms, 'M1', { winner: 2, winnerGames: 1, loserGames: 0 })
    expect(r.reset.sort()).toEqual(['LA', 'P1', 'P3', 'P5', 'P7', 'WA'].sort())
    // WA and LA are immediately playable again with the corrected players.
    expect(get(r.matches, 'WA')).toMatchObject({ player1: 2, player2: 3, status: 'ready', winner: null })
    expect(get(r.matches, 'LA')).toMatchObject({ player1: 1, player2: 4, status: 'ready', winner: null })
    expect(r.becameReady.sort()).toEqual(['LA', 'WA'])
    // Untouched side of the bracket keeps its results.
    for (const slot of ['M2', 'M3', 'M4', 'WB', 'LB'] as Slot[]) expect(get(r.matches, slot).status).toBe('confirmed')
    // Round 3 matches lost one known player each.
    expect(get(r.matches, 'P1')).toMatchObject({ player1: null, player2: 5, status: 'waiting' })
    expect(isComplete(r.matches)).toBe(false)
  })

  it('previewResult counts the reset matches without changing anything', () => {
    const ms = playAll()
    expect(previewResult(ms, 'WB', { winner: 7, winnerGames: 1, loserGames: 0 }).reset.sort()).toEqual(['P1', 'P3'])
    expect(get(ms, 'P1').status).toBe('confirmed')
    expect(previewResult(ms, 'P7', { winner: 8, winnerGames: 1, loserGames: 0 }).reset).toEqual([])
  })

  it('counts only later matches that already had a result', () => {
    let ms = fresh()
    for (const [slot, w] of [['M1', 1], ['M2', 3], ['M3', 5], ['M4', 7]] as const) ms = win(ms, slot, w).matches
    ms = claimResult(ms, 'WA', { winner: 1, winnerGames: 1, loserGames: 0 }) // pending counts as reported
    const r = applyResult(ms, 'M1', { winner: 2, winnerGames: 1, loserGames: 0 })
    expect(r.reset).toEqual(['WA']) // LA was only 'ready', so nothing was lost there
  })

  it('swapping the winner of a final only swaps the two placements', () => {
    const ms = playAll()
    const r = applyResult(ms, 'P1', { winner: 5, winnerGames: 2, loserGames: 1 })
    expect(r.reset).toEqual([])
    expect(computePlacements(r.matches).slice(0, 2)).toEqual([
      { place: 1, playerId: 5 },
      { place: 2, playerId: 1 }
    ])
  })

  it('a corrected bracket can be replayed to completion', () => {
    let ms = applyResult(playAll(), 'M1', { winner: 2, winnerGames: 1, loserGames: 0 }).matches
    for (const slot of ['WA', 'LA', 'P1', 'P3', 'P5', 'P7'] as Slot[]) {
      const m = get(ms, slot)
      ms = win(ms, slot, Math.min(m.player1!, m.player2!)).matches
    }
    expect(isComplete(ms)).toBe(true)
    expect(computePlacements(ms).map((p) => p.playerId)).toHaveLength(8)
  })

  it('resolveBracket on a consistent bracket changes nothing', () => {
    const ms = playAll()
    const r = resolveBracket(ms)
    expect(r.reset).toEqual([])
    expect(r.becameReady).toEqual([])
    expect(r.matches).toEqual(ms)
  })
})

describe('swapping a player mid-tournament', () => {
  it('the replacement takes over unplayed matches; played results stay', () => {
    let ms = win(fresh(), 'M1', 1).matches // player 1 beat 2
    ms = swapPlayer(ms, 1, 9) // player 9 replaces player 1
    expect(get(ms, 'M1')).toMatchObject({ player1: 1, winner: 1, status: 'confirmed' })
    expect(get(ms, 'WA').player1).toBe(9)

    // Later results keep flowing to the replacement, not back to player 1.
    const subs = new Map([[1, 9]])
    const r = applyResult(ms, 'M2', { winner: 3, winnerGames: 1, loserGames: 0 }, subs)
    expect(r.reset).toEqual([])
    expect(get(r.matches, 'WA')).toMatchObject({ player1: 9, player2: 3, status: 'ready' })
  })

  it('drops a pending claim the old player was part of', () => {
    let ms = claimResult(fresh(), 'M1', { winner: 1, winnerGames: 1, loserGames: 0 })
    ms = swapPlayer(ms, 1, 9)
    expect(get(ms, 'M1')).toMatchObject({ player1: 9, player2: 2, status: 'ready', winner: null })
  })

  it('a correction after a swap still routes results to the replacement', () => {
    let ms = fresh()
    for (const [slot, w] of [['M1', 1], ['M2', 3], ['M3', 5], ['M4', 7]] as const) ms = win(ms, slot, w).matches
    ms = swapPlayer(ms, 1, 9)
    const subs = new Map([[1, 9]])
    // Admin realises player 2 actually won M1: then 9 (for player 1) goes to the losers' side.
    const r = applyResult(ms, 'M1', { winner: 2, winnerGames: 1, loserGames: 0 }, subs)
    expect(get(r.matches, 'WA')).toMatchObject({ player1: 2, player2: 3 })
    expect(get(r.matches, 'LA')).toMatchObject({ player1: 9, player2: 4 })
  })
})
