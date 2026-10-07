// The Confirm / Dispute buttons under a reported result.
import { getConfig } from '../db/config'
import { getActivePlayerByDiscordId, getPlayersByIds } from '../db/players'
import { getMatchById, getTournamentById, loadMatches, loadSubstitutions, matchUpdateStatements } from '../db/tournaments'
import { discordApi } from '../discord/api'
import { mentionUser } from '../discord/format'
import { hasRole, requireGuild, userIdOf } from '../discord/permissions'
import { ephemeral, updateMessage } from '../discord/responses'
import { confirmResult, disputeResult } from '../logic/bracket'
import { commitResult } from '../services/results'
import { mentionOf } from '../views/common'
import { CLAIM_PREFIX, adminNeededMessage, confirmedMessage, disputedMessage, opponentOf } from '../views/results'
import type { ButtonHandler } from './registry'

export const claimButtons: ButtonHandler = {
  prefix: CLAIM_PREFIX,
  async handle({ interaction, env, ctx }, [action, matchId]) {
    requireGuild(interaction)
    const db = env.DB
    const match = await getMatchById(db, Number(matchId))
    // Only the latest report of a match, still waiting, can be answered.
    if (!match || match.status !== 'pending' || match.messageId !== interaction.message?.id) {
      return ephemeral('This report is no longer waiting for confirmation.')
    }
    const tournament = (await getTournamentById(db, match.tournamentId))!
    const clickerId = userIdOf(interaction)
    const adminRoleId = await getConfig(db, 'admin_role_id')
    const isAdmin = hasRole(interaction, adminRoleId)
    const clicker = await getActivePlayerByDiscordId(db, clickerId)
    const opponent = opponentOf(match, match.reportedBy)
    const players = await getPlayersByIds(db, [match.player1!, match.player2!])

    if (!isAdmin && clicker?.id !== opponent) {
      return ephemeral(
        clicker && clicker.id === match.reportedBy
          ? 'You reported this result, so your opponent needs to confirm it.'
          : `Only ${mentionOf(players, opponent)} or an admin can answer this report.`
      )
    }
    const by = mentionUser(clickerId)
    const matches = await loadMatches(db, tournament.id)

    if (action === 'dispute') {
      await db.batch(matchUpdateStatements(db, matches, disputeResult(matches, match.slot)))
      ctx.waitUntil(
        discordApi(env)
          .followup(interaction.token, adminNeededMessage(tournament, match, adminRoleId))
          .catch((err) => console.error('Pinging admins failed', err))
      )
      return updateMessage(disputedMessage(tournament, match, players, by))
    }

    const resolved = confirmResult(matches, match.slot, await loadSubstitutions(db, tournament.id))
    const { followUp } = await commitResult(env, tournament, matches, resolved, match.slot, { byAdmin: false, ping: true })
    ctx.waitUntil(followUp().catch((err) => console.error('Confirm follow-up failed', err)))
    return updateMessage(confirmedMessage(tournament, resolved.matches.find((m) => m.slot === match.slot)!, players, by))
  }
}
