// Posting "your match is ready" messages in the tournament channel.
import { getConfig } from '../db/config'
import { getPlayersByIds } from '../db/players'
import { loadMatches, type Tournament } from '../db/tournaments'
import { discordApi } from '../discord/api'
import type { Env } from '../env'
import type { Slot } from '../logic/bracket'
import { matchReadyMessage } from '../views/announce'
import { markAnnounced } from './tournaments'

/** Announces the given matches (if they're still playable), tagging both players. */
export async function announceMatches(env: Env, tournament: Tournament, slots: Slot[]): Promise<void> {
  if (slots.length === 0) return
  const channelId = await getConfig(env.DB, 'channel_id')
  if (!channelId) return
  const matches = (await loadMatches(env.DB, tournament.id)).filter((m) => slots.includes(m.slot) && m.status === 'ready')
  if (matches.length === 0) return
  const players = await getPlayersByIds(env.DB, matches.flatMap((m) => [m.player1!, m.player2!]))
  await discordApi(env).createMessage(channelId, matchReadyMessage(tournament, matches, players))
  await markAnnounced(env.DB, matches.map((m) => m.id))
}
