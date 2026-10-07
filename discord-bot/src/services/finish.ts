// What happens once all 12 matches of a tournament are confirmed.
import { getConfig } from '../db/config'
import { getPlayersByIds, listPlayers } from '../db/players'
import {
  getPointsTable,
  getRewardsTable,
  loadFinishedPlacements,
  replacePlacementsStatements
} from '../db/standings'
import { loadMatches, type Tournament } from '../db/tournaments'
import { discordApi } from '../discord/api'
import type { Env } from '../env'
import { computePlacements, isComplete } from '../logic/bracket'
import { TournamentError } from '../logic/errors'
import { computeStandings } from '../logic/points'
import { summaryMessage } from '../views/summary'
import { channelTarget, playReveal, startRandomTournament } from './draw'
import { deleteUnplayedTournament } from './tournaments'

/** Builds the summary (or correction) message for a finished tournament from the database. */
export async function buildSummary(env: Env, tournament: Tournament, correction: boolean) {
  const db = env.DB
  const matches = await loadMatches(db, tournament.id)
  const placements = computePlacements(matches)
  const allPlacements = await loadFinishedPlacements(db)
  const playerIds = new Set([
    ...matches.flatMap((m) => [m.player1, m.player2]).filter((id): id is number => id !== null),
    ...allPlacements.map((p) => p.playerId),
    ...(await listPlayers(db, { activeOnly: true })).map((p) => p.id)
  ])
  const players = await getPlayersByIds(db, [...playerIds])
  const points = await getPointsTable(db)
  return summaryMessage({
    tournament,
    placements,
    matches,
    players,
    standings: computeStandings(allPlacements, points, [...playerIds]),
    points,
    rewards: await getRewardsTable(db),
    correction
  })
}

/**
 * Called when the last match of a tournament is confirmed, or when a
 * correction leaves a finished (or reopened) tournament complete.
 *  - A tournament in progress: saves placements, posts the summary, then
 *    immediately draws the next tournament with the reveal.
 *  - A corrected tournament: saves the new placements and posts a
 *    "Correction" summary. No new draw.
 */
export async function onTournamentComplete(env: Env, tournament: Tournament): Promise<void> {
  const db = env.DB
  const matches = await loadMatches(db, tournament.id)
  if (!isComplete(matches)) return
  // Decided by the tournament's status when its result was saved: if two finishes race,
  // the loser of the race sees 0 changed rows below and stops, instead of posting a "correction".
  const correction = tournament.status !== 'in_progress'

  const statusUpdate = correction
    ? db.prepare("UPDATE tournaments SET status = 'finished', finished_at = COALESCE(finished_at, ?) WHERE id = ?")
    : // Only one caller may finish a tournament in progress, so it can't be finished (and redrawn) twice.
      db.prepare("UPDATE tournaments SET status = 'finished', finished_at = ? WHERE id = ? AND status = 'in_progress'")
  const results = await db.batch([
    statusUpdate.bind(new Date().toISOString(), tournament.id),
    ...replacePlacementsStatements(db, tournament.id, computePlacements(matches))
  ])
  if (!correction && results[0].meta.changes !== 1) return

  const channelId = await getConfig(db, 'channel_id')
  if (!channelId) return
  const api = discordApi(env)
  const posted = await api.createMessage(channelId, await buildSummary(env, tournament, correction))
  if (!correction) {
    await db.prepare('UPDATE tournaments SET summary_message_id = ? WHERE id = ?').bind(posted.id, tournament.id).run()
    await startNextTournament(env, channelId)
  }
}

/** The automatic draw right after a summary. */
export async function startNextTournament(env: Env, channelId: string): Promise<void> {
  const api = discordApi(env)
  let drawn
  try {
    drawn = await startRandomTournament(env.DB)
  } catch (err) {
    if (!(err instanceof TournamentError)) throw err
    // For example, not exactly 8 active players: tell the admins what's needed.
    await api.createMessage(channelId, {
      content: `⏸️ The next tournament can't start automatically: ${err.message}\nOnce that's fixed, an admin can start it with \`/draw\`.`
    })
    return
  }
  const target = channelTarget(api, channelId)
  try {
    await playReveal(env, target, drawn)
  } catch (err) {
    // If nothing of the draw was shown, undo it so an admin can retry with /draw.
    if (!target.started) await deleteUnplayedTournament(env.DB, drawn.tournament.id)
    throw err
  }
}
