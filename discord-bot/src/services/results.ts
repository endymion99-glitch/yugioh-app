// Saving a final result and everything that follows from it.
import { getConfig } from '../db/config'
import { getPlayersByIds } from '../db/players'
import {
  matchUpdateStatements,
  setClaimInfoStatement,
  setTournamentStatusStatement,
  type StoredMatch,
  type Tournament
} from '../db/tournaments'
import { discordApi } from '../discord/api'
import type { MessagePayload } from '../discord/types'
import type { Env } from '../env'
import { isComplete, type MatchState, type ResolveResult, type Slot } from '../logic/bracket'
import { cancelledMessage, settledByAdminMessage } from '../views/results'
import { announceMatches } from './announce'
import { onTournamentComplete } from './finish'

/** A short fingerprint of a bracket, so a stale "Apply" button can be detected. */
export function bracketFingerprint(matches: MatchState[]): string {
  const text = matches
    .map((m) => [m.slot, m.status, m.player1, m.player2, m.winner, m.scoreP1, m.scoreP2, m.bestOf].join(','))
    .join(';')
  let hash = 0x811c9dc5 // FNV-1a
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36)
}

export interface CommitOptions {
  /** True for an admin result: clears the reporter and marks any open report as settled. */
  byAdmin: boolean
  /** Ping the players of matches that become playable (otherwise announce silently). */
  ping: boolean
}

/**
 * Saves a confirmed result (and the recalculated bracket) in one transaction.
 * Returns the follow-up work (message edits, announcements, finishing the
 * tournament) to run after replying, with ctx.waitUntil.
 */
export async function commitResult(
  env: Env,
  tournament: Tournament,
  before: StoredMatch[],
  resolved: ResolveResult,
  slot: Slot,
  opts: CommitOptions
): Promise<{ complete: boolean; reopened: boolean; followUp: () => Promise<void> }> {
  const db = env.DB
  const target = before.find((m) => m.slot === slot)!
  const statements = matchUpdateStatements(db, before, resolved.matches)
  if (opts.byAdmin) statements.push(setClaimInfoStatement(db, target.id, null, target.messageId))

  const complete = isComplete(resolved.matches)
  // Correcting a finished tournament so that matches must be replayed reopens it (admins only).
  const reopened = tournament.status === 'finished' && !complete
  if (reopened) {
    statements.push(setTournamentStatusStatement(db, tournament.id, 'correcting'))
    statements.push(db.prepare('DELETE FROM placements WHERE tournament_id = ?').bind(tournament.id))
  }
  await db.batch(statements)
  const current: Tournament = reopened ? { ...tournament, status: 'correcting' } : tournament

  const followUp = async () => {
    const channelId = await getConfig(db, 'channel_id')
    const after = new Map(resolved.matches.map((m) => [m.slot, m]))
    const edits: Array<[string, MessagePayload]> = []
    const players = await getPlayersByIds(
      db,
      resolved.matches.flatMap((m) => [m.player1, m.player2]).filter((id): id is number => id !== null)
    )
    // An open report for this match was settled by the admin's result.
    if (opts.byAdmin && target.messageId && (target.status === 'pending' || target.status === 'disputed')) {
      edits.push([target.messageId, settledByAdminMessage(current, after.get(slot)!, players)])
    }
    // Open reports for matches that were reset no longer apply.
    for (const s of resolved.reset) {
      const old = before.find((m) => m.slot === s)!
      if (old.messageId && (old.status === 'pending' || old.status === 'disputed')) edits.push([old.messageId, cancelledMessage(current, old)])
    }
    if (channelId) {
      const api = discordApi(env)
      for (const [messageId, payload] of edits) {
        await api.editMessage(channelId, messageId, payload).catch((err) => console.error('Editing report message failed', err))
      }
    }
    // Only the tournament being played gets "match ready" posts; corrected past tournaments don't.
    if (current.status === 'in_progress') {
      await announceMatches(env, current, resolved.becameReady, { ping: opts.ping }).catch((err) =>
        console.error('Announcing matches failed', err)
      )
    }
    if (complete) await onTournamentComplete(env, current)
  }
  return { complete, reopened, followUp }
}
