import type { Player } from '../db/players'
import { escapeMarkdown, mentionUser } from '../discord/format'

/** Embed accent colour (a Millennium-gold). */
export const COLOR = 0xd4a017

export type PlayerLookup = ReadonlyMap<number, Pick<Player, 'name' | 'discord_user_id'>>

export const nameOf = (players: PlayerLookup, id: number | null) =>
  id === null ? 'TBD' : escapeMarkdown(players.get(id)?.name ?? `Player ${id}`)

export const mentionOf = (players: PlayerLookup, id: number | null) => {
  const p = id === null ? undefined : players.get(id)
  return p ? mentionUser(p.discord_user_id) : nameOf(players, id)
}

export const formatLabel = (bestOf: number) => `Best of ${bestOf}`
