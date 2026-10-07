import { getConfig } from '../db/config'
import { getActivePlayerByDiscordId, getPlayersByIds } from '../db/players'
import { getCurrentTournament, loadMatches, matchUpdateStatements, setClaimInfoStatement } from '../db/tournaments'
import { describeDiscordError, discordApi } from '../discord/api'
import { mentionChannel } from '../discord/format'
import { parseCommand } from '../discord/options'
import { requireGuild, userIdOf } from '../discord/permissions'
import { ephemeral } from '../discord/responses'
import { OptionType } from '../discord/types'
import { SLOTS, claimResult, parseScore } from '../logic/bracket'
import { TournamentError } from '../logic/errors'
import { mentionOf } from '../views/common'
import { claimMessage, opponentOf, replacedMessage } from '../views/results'
import type { Command } from './registry'

export const report: Command = {
  definition: {
    name: 'report',
    description: 'Report the result of your current match',
    options: [
      {
        type: OptionType.STRING,
        name: 'result',
        description: 'Did you win or lose?',
        required: true,
        choices: [
          { name: 'I won', value: 'won' },
          { name: 'I lost', value: 'lost' }
        ]
      },
      {
        type: OptionType.STRING,
        name: 'score',
        description: 'Games won-lost by the winner (only needed for Best of 3)',
        choices: [
          { name: '2-0', value: '2-0' },
          { name: '2-1', value: '2-1' },
          { name: '1-0', value: '1-0' }
        ]
      }
    ]
  },

  async handle({ interaction, env, ctx }) {
    requireGuild(interaction)
    const db = env.DB
    const me = await getActivePlayerByDiscordId(db, userIdOf(interaction))
    if (!me) throw new TournamentError("You're not a tournament player, so there's nothing to report.")
    const tournament = await getCurrentTournament(db)
    if (!tournament) throw new TournamentError('No tournament is in progress right now.')
    const channelId = await getConfig(db, 'channel_id')
    if (!channelId) throw new TournamentError('The tournament channel has not been set up yet. Ask an admin to run `/config channel`.')

    const matches = await loadMatches(db, tournament.id)
    const mine = matches.filter((m) => m.player1 === me.id || m.player2 === me.id)
    const match = mine.find((m) => m.status === 'ready' || m.status === 'pending' || m.status === 'disputed')
    if (!match) {
      const waiting = mine.find((m) => m.status === 'waiting')
      throw new TournamentError(
        waiting
          ? `Your next match (${SLOTS[waiting.slot].name}) isn't ready yet. It starts once the matches before it are finished.`
          : `You have no matches left to play in Tournament #${tournament.number}.`
      )
    }
    if (match.status === 'disputed') {
      throw new TournamentError('The result of your match is disputed. An admin needs to settle it with `/result override`.')
    }

    const { options } = parseCommand(interaction)
    const opponent = opponentOf(match, me.id)!
    const winner = options.result === 'won' ? me.id : opponent
    const score = options.score
    const { winnerGames, loserGames } = parseScore(match.bestOf, score ? String(score) : null)
    const after = claimResult(matches, match.slot, { winner, winnerGames, loserGames })
    const claimed = { ...match, ...after.find((m) => m.slot === match.slot)! }

    const players = await getPlayersByIds(db, [me.id, opponent])
    let messageId: string
    try {
      messageId = (await discordApi(env).createMessage(channelId, claimMessage(tournament, claimed, players, me.id))).id
    } catch (err) {
      throw new TournamentError(`I couldn't post your report in ${mentionChannel(channelId)}. ${describeDiscordError(err)}`)
    }
    await db.batch([...matchUpdateStatements(db, matches, after), setClaimInfoStatement(db, match.id, me.id, messageId)])

    // A newer report replaces an older one that was still waiting.
    if (match.status === 'pending' && match.messageId && match.messageId !== messageId) {
      const oldId = match.messageId
      ctx.waitUntil(
        discordApi(env)
          .editMessage(channelId, oldId, replacedMessage(tournament, match))
          .catch((err) => console.error('Editing old report failed', err))
      )
    }
    return ephemeral(
      `Got it! Your result is posted in ${mentionChannel(channelId)}. Waiting for ${mentionOf(players, opponent)} to confirm it.`
    )
  }
}
