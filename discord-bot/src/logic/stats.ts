// Per-player statistics: match and game records, placements and head-to-head.
import type { PlayerId } from './bracket'
import type { PlacementRecord } from './points'

export interface PlayedMatch {
  player1: PlayerId | null
  player2: PlayerId | null
  winner: PlayerId | null
  scoreP1: number | null
  scoreP2: number | null
}

export interface WinLoss {
  won: number
  lost: number
}

export interface PlayerStats {
  tournaments: number
  matches: WinLoss
  games: WinLoss
  /** placeCounts[0] = number of 1st places, ..., placeCounts[7] = 8th places. */
  placeCounts: number[]
  best: number | null
  average: number | null
  /** Match record against each opponent, keyed by the opponent's player id. */
  headToHead: Map<PlayerId, WinLoss>
}

/**
 * Stats for one player from their confirmed matches and their placements in
 * finished tournaments. Matches without a winner are ignored.
 */
export function computePlayerStats(playerId: PlayerId, matches: PlayedMatch[], placements: PlacementRecord[]): PlayerStats {
  const stats: PlayerStats = {
    tournaments: 0,
    matches: { won: 0, lost: 0 },
    games: { won: 0, lost: 0 },
    placeCounts: Array(8).fill(0),
    best: null,
    average: null,
    headToHead: new Map()
  }
  for (const m of matches) {
    if (m.winner === null || (m.player1 !== playerId && m.player2 !== playerId)) continue
    const isP1 = m.player1 === playerId
    const opponent = isP1 ? m.player2 : m.player1
    if (opponent === null) continue
    const won = m.winner === playerId
    stats.matches[won ? 'won' : 'lost'] += 1
    stats.games.won += (isP1 ? m.scoreP1 : m.scoreP2) ?? 0
    stats.games.lost += (isP1 ? m.scoreP2 : m.scoreP1) ?? 0
    const h2h = stats.headToHead.get(opponent) ?? { won: 0, lost: 0 }
    h2h[won ? 'won' : 'lost'] += 1
    stats.headToHead.set(opponent, h2h)
  }
  const mine = placements.filter((p) => p.playerId === playerId)
  stats.tournaments = mine.length
  for (const p of mine) if (p.place >= 1 && p.place <= 8) stats.placeCounts[p.place - 1] += 1
  if (mine.length) {
    stats.best = Math.min(...mine.map((p) => p.place))
    stats.average = mine.reduce((sum, p) => sum + p.place, 0) / mine.length
  }
  return stats
}
