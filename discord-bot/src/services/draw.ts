// Starting a tournament with a random draw, and playing the reveal animation.
import { listPlayers } from '../db/players'
import type { Tournament } from '../db/tournaments'
import { sleep, type DiscordApi } from '../discord/api'
import type { MessagePayload } from '../discord/types'
import type { Env } from '../env'
import { TOURNAMENT_SIZE, type Pairs } from '../logic/bracket'
import { drawPairs } from '../logic/draw'
import { TournamentError } from '../logic/errors'
import { revealFrames, round1Announcement } from '../views/draw'
import type { PlayerLookup } from '../views/common'
import { createTournament, markAnnounced } from './tournaments'

export interface DrawnTournament {
  tournament: Tournament
  pairs: Pairs
  players: PlayerLookup
  matchIds: number[]
}

/** Draws the 8 active players into pairs and saves the new tournament. */
export async function startRandomTournament(db: D1Database): Promise<DrawnTournament> {
  const active = await listPlayers(db, { activeOnly: true })
  if (active.length !== TOURNAMENT_SIZE) {
    throw new TournamentError(
      `A draw needs exactly ${TOURNAMENT_SIZE} active players, but there are ${active.length}. Check \`/player list\`.`
    )
  }
  const pairs = drawPairs(active.map((p) => p.id))
  const { tournament, matches } = await createTournament(db, pairs)
  return {
    tournament,
    pairs,
    players: new Map(active.map((p) => [p.id, p])),
    matchIds: matches.filter((m) => m.status === 'ready').map((m) => m.id)
  }
}

/** Where the reveal is shown: the reply to /draw, or a message in the tournament channel. */
export interface RevealTarget {
  /** Shows a frame, replacing the previous one. */
  show(payload: MessagePayload): Promise<void>
  /** Posts the final message as a new message, so its mentions ping. */
  finish(payload: MessagePayload): Promise<void>
  /** Whether anything has been posted yet. */
  readonly started: boolean
}

export function interactionTarget(api: DiscordApi, token: string): RevealTarget {
  let started = false
  return {
    get started() {
      return started
    },
    async show(payload) {
      await api.editOriginal(token, payload)
      started = true
    },
    async finish(payload) {
      await api.followup(token, payload)
    }
  }
}

export function channelTarget(api: DiscordApi, channelId: string): RevealTarget {
  let messageId: string | null = null
  return {
    get started() {
      return messageId !== null
    },
    async show(payload) {
      if (messageId === null) messageId = (await api.createMessage(channelId, payload)).id
      else await api.editMessage(channelId, messageId, payload)
    },
    async finish(payload) {
      await api.createMessage(channelId, payload)
    }
  }
}

export const revealDelay = (env: Env) => {
  const ms = Number(env.REVEAL_DELAY_MS ?? 2500)
  return Number.isFinite(ms) && ms >= 0 ? ms : 2500
}

/**
 * Plays the reveal: intro, one Round 1 match per step, then a message tagging
 * everyone. With the default 2.5 s pause that's 5 pauses, about 12.5 s, which
 * stays well inside the ~30 s Cloudflare lets ctx.waitUntil work run after
 * replying, even when the end-of-tournament summary is posted first.
 */
export async function playReveal(env: Env, target: RevealTarget, drawn: DrawnTournament): Promise<void> {
  const { tournament, pairs, players } = drawn
  const delay = revealDelay(env)
  for (const frame of revealFrames(tournament.number, pairs, players)) {
    if (target.started) await sleep(delay)
    await target.show(frame)
  }
  await sleep(delay)
  await target.finish(round1Announcement(tournament.number, pairs, players, `🔥 **Tournament #${tournament.number} begins!**`))
  // Round 1 doesn't need a separate "match ready" post: the draw covered it.
  await markAnnounced(env.DB, drawn.matchIds)
}
