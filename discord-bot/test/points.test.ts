import { describe, expect, it } from 'vitest'
import { computeStandings, describeReward, pointsFor, type PlacementRecord } from '../src/logic/points'

const DEFAULT_POINTS = new Map([[1, 10], [2, 8], [3, 7], [4, 6], [5, 5], [6, 4], [7, 3], [8, 1]])

/** One tournament's placements, given player ids in finishing order. */
const tournament = (id: number, order: number[]): PlacementRecord[] =>
  order.map((playerId, i) => ({ tournamentId: id, playerId, place: i + 1 }))

describe('points', () => {
  it('uses the points table', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((p) => pointsFor(p, DEFAULT_POINTS))).toEqual([10, 8, 7, 6, 5, 4, 3, 1])
  })
})

describe('rewards', () => {
  it('describes the default rewards', () => {
    const r = (place: number, extra: number, cards: number) =>
      describeReward({ place, base_packs: 10, extra_packs: extra, chosen_cards: cards })
    expect(r(1, 0, 4)).toMatchObject({ text: '10 packs + 4 cards of your choice', totalPacks: 10 })
    expect(r(4, 0, 1).text).toBe('10 packs + 1 card of your choice')
    expect(r(5, 4, 0)).toMatchObject({ text: '10 packs + 4 extra packs (14 packs)', totalPacks: 14 })
    expect(r(8, 10, 0).totalPacks).toBe(20)
  })

  it('handles custom combinations', () => {
    expect(describeReward({ place: 1, base_packs: 0, extra_packs: 1, chosen_cards: 1 }).text).toBe(
      '1 extra pack + 1 card of your choice'
    )
    expect(describeReward({ place: 1, base_packs: 0, extra_packs: 0, chosen_cards: 0 }).text).toBe('No reward')
  })
})

describe('standings', () => {
  it('totals points across tournaments', () => {
    const rows = computeStandings(
      [...tournament(1, [1, 2, 3, 4, 5, 6, 7, 8]), ...tournament(2, [2, 1, 3, 4, 5, 6, 7, 8])],
      DEFAULT_POINTS
    )
    expect(rows.slice(0, 3).map((r) => [r.playerId, r.points])).toEqual([[1, 18], [2, 18], [3, 14]])
    expect(rows[0].tournaments).toBe(2)
  })

  it('breaks ties by most 1st places, then 2nd places, and so on', () => {
    // A custom points table where 1st+8th equals 2nd+2nd: both total 10.
    const table = new Map([[1, 9], [2, 5], [3, 4], [4, 3], [5, 3], [6, 2], [7, 1], [8, 1]])
    const placements: PlacementRecord[] = [
      { tournamentId: 1, playerId: 100, place: 2 },
      { tournamentId: 2, playerId: 100, place: 2 },
      { tournamentId: 1, playerId: 200, place: 1 },
      { tournamentId: 2, playerId: 200, place: 8 }
    ]
    const rows = computeStandings(placements, table)
    expect(rows.map((r) => [r.playerId, r.points, r.rank])).toEqual([[200, 10, 1], [100, 10, 2]])
  })

  it('goes further down the places when higher ones are equal', () => {
    // Equal points and no 1st or 2nd places: player 1's 3rd place beats player 2's 4th.
    const table = new Map([[1, 10], [2, 8], [3, 6], [4, 3], [5, 3], [6, 2], [7, 1], [8, 0]])
    const placements: PlacementRecord[] = [
      { tournamentId: 1, playerId: 1, place: 3 }, // 6
      { tournamentId: 2, playerId: 1, place: 8 }, // 0
      { tournamentId: 1, playerId: 2, place: 4 }, // 3
      { tournamentId: 2, playerId: 2, place: 5 } // 3
    ]
    const rows = computeStandings(placements, table)
    expect(rows.map((r) => [r.playerId, r.points, r.rank])).toEqual([[1, 6, 1], [2, 6, 2]]) // 3rd beats 4th
  })

  it('players tied on everything share a rank (1, 2, 2, 4)', () => {
    const placements: PlacementRecord[] = [
      { tournamentId: 1, playerId: 1, place: 1 },
      { tournamentId: 1, playerId: 2, place: 2 },
      { tournamentId: 2, playerId: 3, place: 2 },
      { tournamentId: 1, playerId: 4, place: 3 }
    ]
    const rows = computeStandings(placements, DEFAULT_POINTS)
    expect(rows.map((r) => [r.playerId, r.rank])).toEqual([[1, 1], [2, 2], [3, 2], [4, 4]])
  })

  it('includes listed players who have not finished a tournament yet', () => {
    const rows = computeStandings(tournament(1, [1, 2, 3, 4, 5, 6, 7, 8]), DEFAULT_POINTS, [1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(rows.at(-1)).toMatchObject({ playerId: 9, points: 0, tournaments: 0, rank: 9 })
  })

  it('reflects an edited points table immediately (totals are never stored)', () => {
    const placements = tournament(1, [1, 2, 3, 4, 5, 6, 7, 8])
    const edited = new Map(DEFAULT_POINTS).set(1, 20)
    expect(computeStandings(placements, edited)[0]).toMatchObject({ playerId: 1, points: 20 })
  })
})
