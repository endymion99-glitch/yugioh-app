import { getConfig } from '../db/config'
import {
  deactivatePlayerStatement,
  getActivePlayerByDiscordId,
  getActivePlayerByName,
  insertPlayerStatement,
  listPlayers,
  type Player
} from '../db/players'
import { getCurrentTournament, insertSubstitutionStatement, loadMatches, matchUpdateStatements } from '../db/tournaments'
import { escapeMarkdown, mentionUser } from '../discord/format'
import { parseCommand, resolvedUser } from '../discord/options'
import { requireAdmin, requireGuild } from '../discord/permissions'
import { ephemeral } from '../discord/responses'
import { OptionType, type Interaction } from '../discord/types'
import { SLOTS, TOURNAMENT_SIZE, swapPlayer, type Slot } from '../logic/bracket'
import { TournamentError } from '../logic/errors'
import { announceMatches } from '../services/announce'
import type { Command, CommandContext } from './registry'

const NAME_MAX = 32

const nameOption = (description: string) => ({
  type: OptionType.STRING,
  name: 'name',
  description,
  required: true,
  min_length: 1,
  max_length: NAME_MAX
})

const userOption = (name: string, description: string) => ({ type: OptionType.USER, name, description, required: true })

/** "Yugi (@yugi)" style label used in replies. */
export const playerLabel = (p: Pick<Player, 'name' | 'discord_user_id'>) =>
  `**${escapeMarkdown(p.name)}** (${mentionUser(p.discord_user_id)})`

function cleanName(raw: unknown): string {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ')
  if (!name) throw new TournamentError('Please give the player a name.')
  if (name.length > NAME_MAX) throw new TournamentError(`Player names can be at most ${NAME_MAX} characters.`)
  return name
}

function requireHuman(interaction: Interaction, userId: string) {
  if (resolvedUser(interaction, userId)?.bot) throw new TournamentError("Bots can't be tournament players.")
}

async function requireFreeName(db: D1Database, name: string, exceptPlayerId?: number) {
  const taken = await getActivePlayerByName(db, name)
  if (taken && taken.id !== exceptPlayerId) {
    throw new TournamentError(`There is already an active player called **${escapeMarkdown(taken.name)}**.`)
  }
}

async function requireActivePlayer(db: D1Database, userId: string): Promise<Player> {
  const player = await getActivePlayerByDiscordId(db, userId)
  if (!player) throw new TournamentError(`${mentionUser(userId)} is not an active player.`)
  return player
}

async function addPlayer(db: D1Database, interaction: Interaction, userId: string, rawName: unknown) {
  const name = cleanName(rawName)
  requireHuman(interaction, userId)
  const existing = await getActivePlayerByDiscordId(db, userId)
  if (existing) throw new TournamentError(`${mentionUser(userId)} is already linked to ${playerLabel(existing)}.`)
  await requireFreeName(db, name)
  const active = await listPlayers(db, { activeOnly: true })
  if (active.length >= TOURNAMENT_SIZE) {
    throw new TournamentError(
      `There are already ${TOURNAMENT_SIZE} active players. Use \`/player swap\` to replace someone, or \`/player remove\` first.`
    )
  }
  await insertPlayerStatement(db, name, userId).run()
  const count = active.length + 1
  const next =
    count === TOURNAMENT_SIZE
      ? 'All 8 players are in. You can now start a tournament.'
      : `${TOURNAMENT_SIZE - count} more to go.`
  return ephemeral(`Added ${playerLabel({ name, discord_user_id: userId })}. Active players: ${count}/${TOURNAMENT_SIZE}. ${next}`)
}

async function swap(c: CommandContext, oldUserId: string, newUserId: string, rawName: unknown) {
  const { interaction, env, ctx } = c
  const db = env.DB
  const name = cleanName(rawName)
  const old = await requireActivePlayer(db, oldUserId)
  if (oldUserId === newUserId) throw new TournamentError('The new player must be a different Discord user.')
  requireHuman(interaction, newUserId)
  const clash = await getActivePlayerByDiscordId(db, newUserId)
  if (clash) throw new TournamentError(`${mentionUser(newUserId)} is already an active player (${playerLabel(clash)}).`)
  await requireFreeName(db, name, old.id)

  // The replacement is a new player record, so their stats start fresh.
  const created = await insertPlayerStatement(db, name, newUserId).run()
  const newId = created.meta.last_row_id
  const newPlayer = { name, discord_user_id: newUserId }

  const statements = [deactivatePlayerStatement(db, old.id)]
  let tournamentNote = ''
  let toAnnounce: Slot[] = []
  const current = await getCurrentTournament(db)
  if (current) {
    const before = await loadMatches(db, current.id)
    if (before.some((m) => m.player1 === old.id || m.player2 === old.id)) {
      const after = swapPlayer(before, old.id, newId)
      statements.push(...matchUpdateStatements(db, before, after), insertSubstitutionStatement(db, current.id, old.id, newId))
      const takenOver = after.filter((m) => m.status !== 'confirmed' && (m.player1 === newId || m.player2 === newId))
      toAnnounce = takenOver.filter((m) => m.status === 'ready').map((m) => m.slot)
      tournamentNote = takenOver.length
        ? `\nIn Tournament #${current.number} they take over: ${takenOver.map((m) => SLOTS[m.slot].name).join(', ')}.`
        : `\nThey take ${escapeMarkdown(old.name)}'s place in Tournament #${current.number} for any matches still to come.`
    }
  }
  try {
    await db.batch(statements)
  } catch (err) {
    await db.prepare('DELETE FROM players WHERE id = ?').bind(newId).run()
    throw err
  }
  // Let the replacement and their opponent know about a match they can play now.
  if (current && toAnnounce.length) {
    ctx.waitUntil(announceMatches(env, current, toAnnounce).catch((err) => console.error('Announcing swap failed', err)))
  }
  return ephemeral(
    `${playerLabel(newPlayer)} replaced ${playerLabel(old)}. ${escapeMarkdown(old.name)}'s results and stats are kept on their own record.${tournamentNote}`
  )
}

async function remove(db: D1Database, userId: string) {
  const player = await requireActivePlayer(db, userId)
  const current = await getCurrentTournament(db)
  if (current) {
    const matches = await loadMatches(db, current.id)
    if (matches.some((m) => m.player1 === player.id || m.player2 === player.id)) {
      throw new TournamentError(
        `${playerLabel(player)} is playing in Tournament #${current.number}. Use \`/player swap\` to replace them instead.`
      )
    }
  }
  await deactivatePlayerStatement(db, player.id).run()
  return ephemeral(`Removed ${playerLabel(player)}. Their history is kept. Use \`/player add\` to add someone in their place.`)
}

async function list(db: D1Database) {
  const players = await listPlayers(db)
  const active = players.filter((p) => p.active)
  const former = players.filter((p) => !p.active)
  const lines = [`**Active players (${active.length}/${TOURNAMENT_SIZE})**`]
  lines.push(...(active.length ? active.map((p, i) => `${i + 1}. ${playerLabel(p)}`) : ['_Nobody yet. Add players with `/player add`._']))
  if (former.length) {
    const shown = former.slice(0, 20).map((p) => escapeMarkdown(p.name))
    lines.push('', `**Former players:** ${shown.join(', ')}${former.length > 20 ? ` and ${former.length - 20} more` : ''}`)
  }
  return ephemeral(lines.join('\n'))
}

export const player: Command = {
  definition: {
    name: 'player',
    description: 'Manage the tournament players (admins only)',
    options: [
      {
        type: OptionType.SUB_COMMAND,
        name: 'add',
        description: 'Link a Discord user to a player name',
        options: [userOption('user', 'The Discord user'), nameOption('Their player name')]
      },
      {
        type: OptionType.SUB_COMMAND,
        name: 'swap',
        description: 'Replace a player with someone new (also mid-tournament)',
        options: [
          userOption('old', 'The player leaving'),
          userOption('new', 'The Discord user joining'),
          nameOption("The new player's name")
        ]
      },
      {
        type: OptionType.SUB_COMMAND,
        name: 'remove',
        description: 'Remove a player (not allowed while they are in a tournament)',
        options: [userOption('user', 'The player to remove')]
      },
      { type: OptionType.SUB_COMMAND, name: 'list', description: 'Show all players' }
    ]
  },

  async handle(c) {
    const { interaction, env } = c
    requireGuild(interaction)
    requireAdmin(interaction, await getConfig(env.DB, 'admin_role_id'))
    const { sub, options } = parseCommand(interaction)
    switch (sub) {
      case 'add':
        return addPlayer(env.DB, interaction, String(options.user), options.name)
      case 'swap':
        return swap(c, String(options.old), String(options.new), options.name)
      case 'remove':
        return remove(env.DB, String(options.user))
      case 'list':
        return list(env.DB)
      default:
        throw new TournamentError('Unknown /player option.')
    }
  }
}
