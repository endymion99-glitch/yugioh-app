// Points, rewards and the cumulative leaderboard.
import type { PlayerId } from './bracket'

export type PointsTable = ReadonlyMap<number, number>

export interface RewardRow {
  place: number
  base_packs: number
  extra_packs: number
  chosen_cards: number
}

export interface Reward {
  basePacks: number
  extraPacks: number
  chosenCards: number
  totalPacks: number
  /** E.g. "10 packs + 4 cards of your choice" or "10 packs + 6 extra packs (16 packs)". */
  text: string
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function describeReward(row: RewardRow): Reward {
  const { base_packs: basePacks, extra_packs: extraPacks, chosen_cards: chosenCards } = row
  const totalPacks = basePacks + extraPacks
  const parts: string[] = []
  if (basePacks > 0) parts.push(plural(basePacks, 'pack'))
  if (extraPacks > 0) {
    const extra = plural(extraPacks, 'extra pack')
    parts.push(basePacks > 0 ? `${extra} (${plural(totalPacks, 'pack')})` : extra)
  }
  if (chosenCards > 0) parts.push(`${plural(chosenCards, 'card')} of your choice`)
  return { basePacks, extraPacks, chosenCards, totalPacks, text: parts.length ? parts.join(' + ') : 'No reward' }
}

export interface PlacementRecord {
  tournamentId: number
  playerId: PlayerId
  place: number
}

export interface StandingRow {
  rank: number
  playerId: PlayerId
  points: number
  tournaments: number
  /** placeCounts[0] = number of 1st places, ..., placeCounts[7] = 8th places. */
  placeCounts: number[]
}

/** Points earned for a place, using the current points table. */
export const pointsFor = (place: number, table: PointsTable) => table.get(place) ?? 0

/** Compares two rows: more points first, then more 1st places, then more 2nd places, and so on. */
function compareStanding(a: StandingRow, b: StandingRow): number {
  if (a.points !== b.points) return b.points - a.points
  for (let i = 0; i < 8; i++) {
    if (a.placeCounts[i] !== b.placeCounts[i]) return b.placeCounts[i] - a.placeCounts[i]
  }
  return 0
}

/**
 * The cumulative leaderboard. Everyone in `playerIds` is listed, even with
 * no tournaments yet. Players still tied after every tiebreak share a rank
 * (1, 2, 2, 4).
 */
export function computeStandings(
  placements: readonly PlacementRecord[],
  table: PointsTable,
  playerIds: readonly PlayerId[] = []
): StandingRow[] {
  const rows = new Map<PlayerId, StandingRow>()
  const row = (id: PlayerId) => {
    let r = rows.get(id)
    if (!r) rows.set(id, (r = { rank: 0, playerId: id, points: 0, tournaments: 0, placeCounts: Array(8).fill(0) }))
    return r
  }
  for (const id of playerIds) row(id)
  for (const p of placements) {
    const r = row(p.playerId)
    r.points += pointsFor(p.place, table)
    r.tournaments += 1
    if (p.place >= 1 && p.place <= 8) r.placeCounts[p.place - 1] += 1
  }

  // Sort by the tiebreak rules, then by id so the order of exact ties is stable.
  const sorted = [...rows.values()].sort((a, b) => compareStanding(a, b) || a.playerId - b.playerId)
  sorted.forEach((r, i) => {
    r.rank = i > 0 && compareStanding(sorted[i - 1], r) === 0 ? sorted[i - 1].rank : i + 1
  })
  return sorted
}
