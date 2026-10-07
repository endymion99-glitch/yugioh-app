// Creating tournaments and keeping their matches in the database.
import { getStageFormats } from '../db/config'
import { getCurrentTournament, loadMatches, type StoredMatch, type Tournament } from '../db/tournaments'
import { SLOTS, createBracket, feederCode, type Pairs } from '../logic/bracket'
import { TournamentError } from '../logic/errors'

/** Saves a new tournament (numbered after the last one) with its 12 matches, all at once. */
export async function createTournament(
  db: D1Database,
  pairs: Pairs
): Promise<{ tournament: Tournament; matches: StoredMatch[] }> {
  const current = await getCurrentTournament(db)
  if (current) throw new TournamentError(`Tournament #${current.number} is still in progress.`)

  const matches = createBracket(pairs, await getStageFormats(db))
  const number = ((await db.prepare('SELECT MAX(number) AS n FROM tournaments').first<number>('n')) ?? 0) + 1
  const tournamentId = '(SELECT id FROM tournaments WHERE number = ?)'
  try {
    await db.batch([
      db.prepare("INSERT INTO tournaments (number, status) VALUES (?, 'in_progress')").bind(number),
      ...matches.map((m) => {
        const f = SLOTS[m.slot].feeders
        return db
          .prepare(
            `INSERT INTO matches (tournament_id, stage, slot, best_of, player1_id, player2_id, status, feeder_a, feeder_b)
             VALUES (${tournamentId}, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(number, m.stage, m.slot, m.bestOf, m.player1, m.player2, m.status, f ? feederCode(f[0]) : null, f ? feederCode(f[1]) : null)
      })
    ])
  } catch (err) {
    // Two draws at the same moment: the database only allows one tournament in progress.
    if (String(err).includes('UNIQUE')) throw new TournamentError('A tournament was just started by someone else.')
    throw err
  }
  const tournament = (await db.prepare('SELECT * FROM tournaments WHERE number = ?').bind(number).first<Tournament>())!
  return { tournament, matches: await loadMatches(db, tournament.id) }
}

/** Removes a tournament nobody has seen yet (used when posting its draw failed). */
export async function deleteUnplayedTournament(db: D1Database, tournamentId: number): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM matches WHERE tournament_id = ?').bind(tournamentId),
    db.prepare('DELETE FROM substitutions WHERE tournament_id = ?').bind(tournamentId),
    db.prepare('DELETE FROM tournaments WHERE id = ?').bind(tournamentId)
  ])
}

export async function markAnnounced(db: D1Database, matchIds: number[], now = new Date().toISOString()): Promise<void> {
  if (matchIds.length === 0) return
  await db.batch(matchIds.map((id) => db.prepare('UPDATE matches SET announced_at = ? WHERE id = ?').bind(now, id)))
}
