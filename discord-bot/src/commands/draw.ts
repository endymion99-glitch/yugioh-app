import { getConfig } from '../db/config'
import { describeDiscordError, discordApi } from '../discord/api'
import { mentionChannel } from '../discord/format'
import { requireAdmin, requireGuild } from '../discord/permissions'
import { deferred } from '../discord/responses'
import { TournamentError } from '../logic/errors'
import { channelTarget, interactionTarget, playReveal, startRandomTournament } from '../services/draw'
import { deleteUnplayedTournament } from '../services/tournaments'
import type { Command } from './registry'

export const draw: Command = {
  definition: {
    name: 'draw',
    description: 'Start a new tournament with a random draw (admins only)'
  },

  async handle({ interaction, env, ctx }) {
    requireGuild(interaction)
    requireAdmin(interaction, await getConfig(env.DB, 'admin_role_id'))
    const channelId = await getConfig(env.DB, 'channel_id')
    if (!channelId) throw new TournamentError('Set the tournament channel first with `/config channel`.')

    const drawn = await startRandomTournament(env.DB)
    const api = discordApi(env)

    // Run in the tournament channel: the reply itself becomes the reveal.
    if (interaction.channel_id === channelId) {
      ctx.waitUntil(
        playReveal(env, interactionTarget(api, interaction.token), drawn).catch((err) =>
          console.error('Draw reveal failed', err)
        )
      )
      return deferred()
    }

    // Run anywhere else: reveal in the tournament channel, and tell the admin privately.
    const target = channelTarget(api, channelId)
    ctx.waitUntil(
      (async () => {
        try {
          await playReveal(env, target, drawn)
          await api.editOriginal(interaction.token, {
            content: `Tournament #${drawn.tournament.number} has been drawn in ${mentionChannel(channelId)}.`
          })
        } catch (err) {
          console.error('Draw reveal failed', err)
          let content = `Something went wrong while posting the draw in ${mentionChannel(channelId)}. ${describeDiscordError(err)}`
          if (!target.started) {
            // Nobody has seen the draw, so undo it and let the admin try again.
            await deleteUnplayedTournament(env.DB, drawn.tournament.id)
            content += '\nNo tournament was created, so you can run `/draw` again once that is fixed.'
          }
          await api.editOriginal(interaction.token, { content }).catch(() => {})
        }
      })()
    )
    return deferred({ ephemeral: true })
  }
}
