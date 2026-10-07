// Tournaments, their matches and mid-tournament substitutions.
import type { BestOf, MatchState, MatchStatus, PlayerId, Slot, Stage } from '../logic/bracket'

export interface Tournament {
  id: number
  number: number
  status: 'in_progress' | 'finished' | 'correcting'
  created_at: string
  finished_at: string | null
  summary_message_id: string | null
}

export async function getCurrentTournament(db: D1Database): Promise<Tournament | null> {
  return db.prepare("SELECT * FROM tournaments WHERE status = 'in_progress'").first<Tournament>()
}

interface MatchRow {
  id: number
  tournament_id: number
  stage: Stage
  slot: Slot
  best_of: BestOf
  player1_id: number | null
  player2_id: number | null
  winner_id: number | null
  score_p1: number | null
  score_p2: number | null
  status: MatchStatus
  feeder_a: string | null
  feeder_b: string | null
  reported_by: number | null
  confirmed_at: string | null
  message_id: string | null
  announced_at: string | null
}

/** A match as stored, with the bookkeeping columns the pure logic doesn't need. */
export interface StoredMatch extends MatchState {
  id: number
  tournamentId: number
  reportedBy: PlayerId | null
  confirmedAt: string | null
  messageId: string | null
  announcedAt: string | null
}

const fromRow = (r: MatchRow): StoredMatch => ({
  id: r.id,
  tournamentId: r.tournament_id,
  slot: r.slot,
  stage: r.stage,
  bestOf: r.best_of,
  player1: r.player1_id,
  player2: r.player2_id,
  winner: r.winner_id,
  scoreP1: r.score_p1,
  scoreP2: r.score_p2,
  status: r.status,
  reportedBy: r.reported_by,
  confirmedAt: r.confirmed_at,
  messageId: r.message_id,
  announcedAt: r.announced_at
})

export async function loadMatches(db: D1Database, tournamentId: number): Promise<StoredMatch[]> {
  const { results } = await db.prepare('SELECT * FROM matches WHERE tournament_id = ? ORDER BY id').bind(tournamentId).all<MatchRow>()
  return results.map(fromRow)
}

const SAME_FIELDS = ['bestOf', 'player1', 'player2', 'winner', 'scoreP1', 'scoreP2', 'status'] as const

/**
 * UPDATE statements for every match whose state changed between `before`
 * and `after`. Run them with db.batch() so they apply all-or-nothing.
 */
export function matchUpdateStatements(
  db: D1Database,
  before: StoredMatch[],
  after: MatchState[],
  now = new Date().toISOString()
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = []
  for (const next of after) {
    const prev = before.find((m) => m.slot === next.slot)
    if (!prev || SAME_FIELDS.every((f) => prev[f] === next[f])) continue
    const playersChanged = prev.player1 !== next.player1 || prev.player2 !== next.player2
    const keepsClaim = next.status === 'pending' || next.status === 'disputed' || next.status === 'confirmed'
    const confirmedAt =
      next.status !== 'confirmed' ? null : prev.status === 'confirmed' && prev.confirmedAt ? prev.confirmedAt : now
    statements.push(
      db
        .prepare(
          `UPDATE matches SET best_of = ?, player1_id = ?, player2_id = ?, winner_id = ?, score_p1 = ?, score_p2 = ?,
             status = ?, reported_by = ?, confirmed_at = ?, announced_at = ? WHERE id = ?`
        )
        .bind(
          next.bestOf,
          next.player1,
          next.player2,
          next.winner,
          next.scoreP1,
          next.scoreP2,
          next.status,
          keepsClaim ? prev.reportedBy : null,
          confirmedAt,
          playersChanged ? null : prev.announcedAt,
          prev.id
        )
    )
  }
  return statements
}

export async function loadSubstitutions(db: D1Database, tournamentId: number): Promise<Map<PlayerId, PlayerId>> {
  const { results } = await db
    .prepare('SELECT old_player_id, new_player_id FROM substitutions WHERE tournament_id = ?')
    .bind(tournamentId)
    .all<{ old_player_id: number; new_player_id: number }>()
  return new Map(results.map((r) => [r.old_player_id, r.new_player_id]))
}

export const insertSubstitutionStatement = (db: D1Database, tournamentId: number, oldId: PlayerId, newId: PlayerId) =>
  db
    .prepare('INSERT INTO substitutions (tournament_id, old_player_id, new_player_id) VALUES (?, ?, ?)')
    .bind(tournamentId, oldId, newId)
