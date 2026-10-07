import { getConfig } from '../db/config'
import { getActivePlayerByDiscordId, type Player } from '../db/players'
import { describeDiscordError, discordApi } from '../discord/api'
import { mentionChannel, mentionUser } from '../discord/format'
import { parseCommand } from '../discord/options'
import { requireAdmin, requireGuild } from '../discord/permissions'
import { ephemeral } from '../discord/responses'
import { OptionType } from '../discord/types'
import type { Pairs } from '../logic/bracket'
import { TournamentError } from '../logic/errors'
import { createTournament, markAnnounced } from '../services/tournaments'
import { round1Announcement } from '../views/draw'
import type { Command } from './registry'

const SEATS = ['m1_p1', 'm1_p2', 'm2_p1', 'm2_p2', 'm3_p1', 'm3_p2', 'm4_p1', 'm4_p2'] as const

export const tournament: Command = {
  definition: {
    name: 'tournament',
    description: 'Tournament management (admins only)',
    options: [
      {
        type: OptionType.SUB_COMMAND,
        name: 'create-manual',
        description: 'Create a tournament from pairings you choose (no random draw)',
        options: SEATS.map((seat) => ({
          type: OptionType.USER,
          name: seat,
          description: `Round 1 Match ${seat[1]}, player ${seat[4]}`,
          required: true
        }))
      }
    ]
  },

  async handle({ interaction, env }) {
    requireGuild(interaction)
    requireAdmin(interaction, await getConfig(env.DB, 'admin_role_id'))
    const { sub, options } = parseCommand(interaction)
    if (sub !== 'create-manual') throw new TournamentError('Unknown /tournament option.')
    const channelId = await getConfig(env.DB, 'channel_id')
    if (!channelId) throw new TournamentError('Set the tournament channel first with `/config channel`.')

    const userIds = SEATS.map((seat) => String(options[seat] ?? ''))
    const seen = new Set<string>()
    for (const id of userIds) {
      if (seen.has(id)) throw new TournamentError(`${mentionUser(id)} is listed more than once.`)
      seen.add(id)
    }
    const players: Player[] = []
    for (const id of userIds) {
      const p = await getActivePlayerByDiscordId(env.DB, id)
      if (!p) throw new TournamentError(`${mentionUser(id)} is not an active player. Add them with \`/player add\` first.`)
      players.push(p)
    }
    // 8 different active players. At most 8 can be active, so that's everyone.
    const pairs = [0, 2, 4, 6].map((i) => [players[i].id, players[i + 1].id]) as Pairs

    const { tournament: t, matches } = await createTournament(env.DB, pairs)
    const lookup = new Map(players.map((p) => [p.id, p]))
    let note = `Pairings posted in ${mentionChannel(channelId)}.`
    try {
      await discordApi(env).createMessage(
        channelId,
        round1Announcement(t.number, pairs, lookup, `📋 **Tournament #${t.number}** has been set up with these pairings:`)
      )
      await markAnnounced(env.DB, matches.filter((m) => m.status === 'ready').map((m) => m.id))
    } catch (err) {
      console.error('Posting manual pairings failed', err)
      note = `I couldn't post the pairings in ${mentionChannel(channelId)}: ${describeDiscordError(err)}`
    }
    return ephemeral(
      `Created **Tournament #${t.number}** from your pairings. ${note}\n` +
        'For matches that were already played, enter the results with `/result override`.'
    )
  }
}
