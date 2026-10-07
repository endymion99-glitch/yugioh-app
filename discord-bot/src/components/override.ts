// The Apply / Cancel buttons on the private "this will reset N matches" warning.
import { getConfig } from '../db/config'
import { getTournamentById, loadMatches } from '../db/tournaments'
import { requireAdmin } from '../discord/permissions'
import { updateMessage } from '../discord/responses'
import { SLOTS, type Slot } from '../logic/bracket'
import { applyOverride } from '../services/override'
import { bracketFingerprint } from '../services/results'
import { OVERRIDE_PREFIX } from '../views/results'
import type { ButtonHandler } from './registry'

export const overrideButtons: ButtonHandler = {
  prefix: OVERRIDE_PREFIX,
  async handle({ interaction, env, ctx }, parts) {
    requireAdmin(interaction, await getConfig(env.DB, 'admin_role_id'))
    const [action, tournamentId, slot, winner, games, ping, fingerprint] = parts
    if (action === 'cancel') return updateMessage({ content: 'Cancelled. Nothing was changed.', components: [] })

    const tournament = await getTournamentById(env.DB, Number(tournamentId))
    if (!tournament || !SLOTS[slot as Slot]) return updateMessage({ content: 'That match no longer exists.', components: [] })
    // Someone changed the bracket since the warning was shown: the warning may be wrong now.
    if (bracketFingerprint(await loadMatches(env.DB, tournament.id)) !== fingerprint) {
      return updateMessage({
        content: 'The bracket changed since this warning was shown, so nothing was applied. Please run `/result override` again.',
        components: []
      })
    }
    const outcome = await applyOverride(
      env,
      tournament,
      slot as Slot,
      { winner: Number(winner), winnerGames: Number(games[0]), loserGames: Number(games[1]) },
      ping === '1'
    )
    ctx.waitUntil(outcome.followUp().catch((err) => console.error('Override follow-up failed', err)))
    return updateMessage({ content: outcome.summary, components: [] })
  }
}
