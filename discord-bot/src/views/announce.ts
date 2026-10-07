// "Your match is ready" posts that tag both players.
import type { StoredMatch, Tournament } from '../db/tournaments'
import type { MessagePayload } from '../discord/types'
import { SLOTS } from '../logic/bracket'
import { formatLabel, mentionOf, type PlayerLookup } from './common'

export function matchReadyMessage(tournament: Tournament, matches: StoredMatch[], players: PlayerLookup): MessagePayload {
  const blocks = matches.map(
    (m) =>
      `**Tournament #${tournament.number} · ${SLOTS[m.slot].name}** (${formatLabel(m.bestOf)})\n` +
      `${mentionOf(players, m.player1)} vs ${mentionOf(players, m.player2)}`
  )
  const userIds = matches
    .flatMap((m) => [m.player1, m.player2])
    .map((id) => (id === null ? undefined : players.get(id)?.discord_user_id))
    .filter((id): id is string => !!id)
  return {
    content: [
      matches.length === 1 ? '⚔️ **A new match is ready!**' : '⚔️ **New matches are ready!**',
      '',
      blocks.join('\n\n'),
      '',
      'Play it, then report the result with `/report`.'
    ].join('\n'),
    allowed_mentions: { users: [...new Set(userIds)] }
  }
}
