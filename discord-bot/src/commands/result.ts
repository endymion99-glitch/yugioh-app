import { getConfig } from '../db/config'
import { getPlayersByIds } from '../db/players'
import { getCurrentTournament, getTournamentByNumber, loadMatches, loadSubstitutions } from '../db/tournaments'
import { mentionUser } from '../discord/format'
import { parseCommand } from '../discord/options'
import { requireAdmin, requireGuild } from '../discord/permissions'
import { ephemeral } from '../discord/responses'
import { OptionType } from '../discord/types'
import { SLOTS, SLOT_ORDER, applyResult, hasResult, parseScore, type Slot } from '../logic/bracket'
import { TournamentError } from '../logic/errors'
import { applyOverride } from '../services/override'
import { bracketFingerprint } from '../services/results'
import { nameOf } from '../views/common'
import { OVERRIDE_PREFIX, overrideWarning } from '../views/results'
import type { Command } from './registry'

/** Button id for "Apply" on the reset warning; carries everything needed to apply it later. */
export const overrideButtonId = (
  tournamentId: number,
  slot: Slot,
  winner: number,
  winnerGames: number,
  loserGames: number,
  ping: boolean,
  fingerprint: string
) => [OVERRIDE_PREFIX, 'apply', tournamentId, slot, winner, `${winnerGames}${loserGames}`, ping ? 1 : 0, fingerprint].join(':')

export const result: Command = {
  definition: {
    name: 'result',
    description: 'Set or correct match results (admins only)',
    options: [
      {
        type: OptionType.SUB_COMMAND,
        name: 'override',
        description: 'Set or change the result of any match, including past tournaments',
        options: [
          {
            type: OptionType.STRING,
            name: 'match',
            description: 'Which match',
            required: true,
            choices: SLOT_ORDER.map((slot) => ({ name: SLOTS[slot].name, value: slot }))
          },
          { type: OptionType.USER, name: 'winner', description: 'Who won the match', required: true },
          {
            type: OptionType.STRING,
            name: 'score',
            description: 'Games won-lost by the winner (only needed for Best of 3)',
            choices: [
              { name: '2-0', value: '2-0' },
              { name: '2-1', value: '2-1' },
              { name: '1-0', value: '1-0' }
            ]
          },
          {
            type: OptionType.INTEGER,
            name: 'tournament',
            description: 'Tournament number (default: the one in progress)',
            min_value: 1
          },
          {
            type: OptionType.BOOLEAN,
            name: 'ping_players',
            description: 'Notify players whose next match becomes ready (default: no, announced silently)'
          }
        ]
      }
    ]
  },

  async handle({ interaction, env, ctx }) {
    requireGuild(interaction)
    requireAdmin(interaction, await getConfig(env.DB, 'admin_role_id'))
    const { sub, options } = parseCommand(interaction)
    if (sub !== 'override') throw new TournamentError('Unknown /result option.')

    const tournament = options.tournament
      ? await getTournamentByNumber(env.DB, Number(options.tournament))
      : await getCurrentTournament(env.DB)
    if (!tournament) {
      throw new TournamentError(
        options.tournament
          ? `There is no Tournament #${options.tournament}.`
          : 'No tournament is in progress. To change a past result, fill in the `tournament` number.'
      )
    }

    const slot = String(options.match) as Slot
    if (!SLOTS[slot]) throw new TournamentError('Unknown match.')
    const matches = await loadMatches(env.DB, tournament.id)
    const match = matches.find((m) => m.slot === slot)!
    if (match.player1 === null || match.player2 === null) {
      throw new TournamentError(`${SLOTS[slot].name} can't have a result yet: the matches before it aren't finished.`)
    }
    const players = await getPlayersByIds(env.DB, [match.player1, match.player2])
    const winnerUser = String(options.winner)
    const winner = [match.player1, match.player2].find((id) => players.get(id)?.discord_user_id === winnerUser)
    if (winner === undefined) {
      throw new TournamentError(
        `${mentionUser(winnerUser)} isn't playing in ${SLOTS[slot].name}. It's ${nameOf(players, match.player1)} vs ${nameOf(players, match.player2)}.`
      )
    }
    const { winnerGames, loserGames } = parseScore(match.bestOf, options.score ? String(options.score) : null)
    const ping = Boolean(options.ping_players)

    const p1Won = winner === match.player1
    const sameResult =
      match.status === 'confirmed' &&
      match.winner === winner &&
      match.scoreP1 === (p1Won ? winnerGames : loserGames) &&
      match.scoreP2 === (p1Won ? loserGames : winnerGames)
    if (sameResult) return ephemeral('That is already the result of this match. Nothing changed.')

    // Warn first if later matches that already have results would be reset.
    const preview = applyResult(matches, slot, { winner, winnerGames, loserGames }, await loadSubstitutions(env.DB, tournament.id))
    const lost = matches.filter((m) => preview.reset.includes(m.slot) && hasResult(m))
    if (lost.length) {
      const allPlayers = await getPlayersByIds(
        env.DB,
        matches.flatMap((m) => [m.player1, m.player2]).filter((id): id is number => id !== null)
      )
      const shown = preview.matches.find((m) => m.slot === slot)!
      const id = overrideButtonId(tournament.id, slot, winner, winnerGames, loserGames, ping, bracketFingerprint(matches))
      return ephemeral(overrideWarning(tournament, shown, allPlayers, lost, id))
    }

    const outcome = await applyOverride(env, tournament, slot, { winner, winnerGames, loserGames }, ping)
    ctx.waitUntil(outcome.followUp().catch((err) => console.error('Override follow-up failed', err)))
    return ephemeral(outcome.summary)
  }
}
