import { getConfig, setConfig, setStageFormat } from '../db/config'
import { getCurrentTournament } from '../db/tournaments'
import { mentionChannel, mentionRole } from '../discord/format'
import { parseCommand } from '../discord/options'
import { hasRole, isServerManager, requireAdmin, requireGuild } from '../discord/permissions'
import { ephemeral } from '../discord/responses'
import { OptionType } from '../discord/types'
import { STAGE_NAMES, type BestOf, type Stage } from '../logic/bracket'
import { TournamentError } from '../logic/errors'
import type { Command } from './registry'

const STAGE_CHOICES = (Object.keys(STAGE_NAMES) as Stage[]).map((stage) => ({ name: STAGE_NAMES[stage], value: stage }))

export const config: Command = {
  definition: {
    name: 'config',
    description: 'Tournament bot settings (admins only)',
    options: [
      {
        type: OptionType.SUB_COMMAND,
        name: 'admin-role',
        description: 'Set which role counts as tournament admin',
        options: [{ type: OptionType.ROLE, name: 'role', description: 'The tournament admin role', required: true }]
      },
      {
        type: OptionType.SUB_COMMAND,
        name: 'channel',
        description: 'Set the channel where the bot posts tournament updates',
        options: [
          {
            type: OptionType.CHANNEL,
            name: 'channel',
            description: 'The tournament channel',
            required: true,
            channel_types: [0, 5] // text and announcement channels
          }
        ]
      },
      {
        type: OptionType.SUB_COMMAND,
        name: 'format',
        description: 'Set Best of 1 or Best of 3 for a stage (applies to future tournaments)',
        options: [
          { type: OptionType.STRING, name: 'stage', description: 'Which stage', required: true, choices: STAGE_CHOICES },
          {
            type: OptionType.INTEGER,
            name: 'best_of',
            description: 'The match format',
            required: true,
            choices: [
              { name: 'Best of 1', value: 1 },
              { name: 'Best of 3', value: 3 }
            ]
          },
          {
            type: OptionType.BOOLEAN,
            name: 'apply_to_current',
            description: 'Also change matches of this stage in the current tournament that have no result yet'
          }
        ]
      }
    ]
  },

  async handle({ interaction, env }) {
    requireGuild(interaction)
    const { sub, options } = parseCommand(interaction)
    const adminRoleId = await getConfig(env.DB, 'admin_role_id')

    if (sub === 'admin-role') {
      // Server managers can always set this, so a deleted role can't lock everyone out.
      if (!isServerManager(interaction) && !hasRole(interaction, adminRoleId)) {
        throw new TournamentError(
          'Only someone with the Manage Server permission (or the current admin role) can set the admin role.'
        )
      }
      const roleId = String(options.role)
      if (roleId === interaction.guild_id) throw new TournamentError("@everyone can't be the admin role. Pick a specific role.")
      await setConfig(env.DB, 'admin_role_id', roleId)
      const note = hasRole(interaction, roleId)
        ? ''
        : "\n\nYou don't have this role yourself yet. Give it to yourself (Server Settings → Members) to use the admin commands."
      return ephemeral(`Done. Members with the ${mentionRole(roleId)} role are now tournament admins.${note}`)
    }

    requireAdmin(interaction, adminRoleId)

    if (sub === 'channel') {
      const channelId = String(options.channel)
      await setConfig(env.DB, 'channel_id', channelId)
      return ephemeral(`Done. Tournament posts will go to ${mentionChannel(channelId)}.`)
    }

    if (sub === 'format') {
      const stage = String(options.stage) as Stage
      const bestOf = Number(options.best_of) as BestOf
      if (!(stage in STAGE_NAMES) || (bestOf !== 1 && bestOf !== 3)) throw new TournamentError('Unknown stage or format.')
      await setStageFormat(env.DB, stage, bestOf)
      let message = `Done. **${STAGE_NAMES[stage]}** is now **Best of ${bestOf}** for future tournaments.`

      if (options.apply_to_current) {
        const current = await getCurrentTournament(env.DB)
        if (!current) {
          message += '\nThere is no tournament in progress, so nothing else changed.'
        } else {
          const changed = await env.DB.prepare(
            "UPDATE matches SET best_of = ? WHERE tournament_id = ? AND stage = ? AND status IN ('waiting', 'ready') AND best_of <> ?"
          )
            .bind(bestOf, current.id, stage, bestOf)
            .run()
          const reported = await env.DB.prepare(
            "SELECT COUNT(*) AS n FROM matches WHERE tournament_id = ? AND stage = ? AND status IN ('pending', 'disputed', 'confirmed')"
          )
            .bind(current.id, stage)
            .first<number>('n')
          message += `\nIn Tournament #${current.number}, ${changed.meta.changes} match(es) were changed to Best of ${bestOf}.`
          if (reported) message += ` ${reported} match(es) already have a result and were left as they were.`
        }
      }
      return ephemeral(message)
    }

    throw new TournamentError('Unknown /config option.')
  }
}
