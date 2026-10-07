import { describe, expect, it } from 'vitest'
import { computePlayerStats, type PlayedMatch } from '../src/logic/stats'

const m = (player1: number, player2: number, winner: number, scoreP1 = winner === player1 ? 1 : 0, scoreP2 = winner === player2 ? 1 : 0): PlayedMatch => ({
  player1,
  player2,
  winner,
  scoreP1,
  scoreP2
})

describe('computePlayerStats', () => {
  it('counts matches, games and head-to-head from both sides of the bracket', () => {
    const matches = [
      m(1, 2, 1), // beat 2
      m(3, 1, 3), // lost to 3
      m(1, 3, 1, 2, 1), // beat 3 in a Bo3, 2-1
      m(2, 4, 4), // not involving player 1
      { player1: 1, player2: 5, winner: null, scoreP1: null, scoreP2: null } // not played yet
    ]
    const s = computePlayerStats(1, matches, [])
    expect(s.matches).toEqual({ won: 2, lost: 1 })
    expect(s.games).toEqual({ won: 3, lost: 2 })
    expect(s.headToHead).toEqual(new Map([[2, { won: 1, lost: 0 }], [3, { won: 1, lost: 1 }]]))
  })

  it('summarises placements: count, best, average and place counts', () => {
    const placements = [
      { tournamentId: 1, playerId: 1, place: 3 },
      { tournamentId: 2, playerId: 1, place: 1 },
      { tournamentId: 3, playerId: 1, place: 8 },
      { tournamentId: 3, playerId: 2, place: 1 }
    ]
    const s = computePlayerStats(1, [], placements)
    expect(s.tournaments).toBe(3)
    expect(s.best).toBe(1)
    expect(s.average).toBe(4)
    expect(s.placeCounts).toEqual([1, 0, 1, 0, 0, 0, 0, 1])
  })

  it('handles a player with no history', () => {
    const s = computePlayerStats(9, [m(1, 2, 1)], [])
    expect(s).toMatchObject({ tournaments: 0, best: null, average: null, matches: { won: 0, lost: 0 } })
    expect(s.headToHead.size).toBe(0)
  })
})
