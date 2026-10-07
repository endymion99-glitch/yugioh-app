// Commands everyone can use: /bracket, /mymatch, /standings, /history, /stats.
import { getActivePlayerByDiscordId, getPlayersByIds, listPlayers, type Player } from '../db/players'
import { getPointsTable, loadFinishedPlacements } from '../db/standings'
import { getCurrentTournament, getTournamentByNumber, loadMatches, type StoredMatch, type Tournament } from '../db/tournaments'
import { mentionUser } from '../discord/format'
import { parseCommand } from '../discord/options'
import { requireGuild, userIdOf } from '../discord/permissions'
import { ephemeral, reply } from '../discord/responses'
import { OptionType } from '../discord/types'
import { SLOTS, type Placement, type PlayerId } from '../logic/bracket'
import { TournamentError } from '../logic/errors'
import { computeStandings } from '../logic/points'
import { computePlayerStats } from '../logic/stats'
import {
  bracketMessage,
  historyDetailMessage,
  historyListMessage,
  myMatchText,
  standingsMessage,
  statsMessage
} from '../views/info'
import type { Command } from './registry'

const PAGE_SIZE = 10

const tournamentOption = (description: string) => ({
  type: OptionType.INTEGER,
  name: 'tournament',
  description,
  min_value: 1
})

const idsIn = (matches: StoredMatch[]) => matches.flatMap((m) => [m.player1, m.player2]).filter((id): id is number => id !== null)

async function latestTournament(db: D1Database): Promise<Tournament | null> {
  return db.prepare('SELECT * FROM tournaments ORDER BY number DESC LIMIT 1').first<Tournament>()
}

async function placementsOf(db: D1Database, tournamentIds: number[]): Promise<Map<number, Placement[]>> {
  const out = new Map<number, Placement[]>(tournamentIds.map((id) => [id, []]))
  if (tournamentIds.length === 0) return out
  const { results } = await db
    .prepare(`SELECT tournament_id, player_id, place FROM placements WHERE tournament_id IN (${tournamentIds.map(() => '?').join(', ')})`)
    .bind(...tournamentIds)
    .all<{ tournament_id: number; player_id: number; place: number }>()
  for (const r of results) out.get(r.tournament_id)?.push({ playerId: r.player_id, place: r.place })
  return out
}

/** A Discord user's player record: the active one, or else their most recent former one. */
async function playerForUser(db: D1Database, userId: string): Promise<Player | null> {
  return (
    (await getActivePlayerByDiscordId(db, userId)) ??
    (await db.prepare('SELECT * FROM players WHERE discord_user_id = ? ORDER BY id DESC LIMIT 1').bind(userId).first<Player>())
  )
}

export const bracket: Command = {
  definition: {
    name: 'bracket',
    description: 'Show the tournament bracket and the status of every match',
    options: [tournamentOption('Tournament number (default: the current one)')]
  },
  async handle({ interaction, env }) {
    requireGuild(interaction)
    const { options } = parseCommand(interaction)
    const t = options.tournament
      ? await getTournamentByNumber(env.DB, Number(options.tournament))
      : ((await getCurrentTournament(env.DB)) ?? (await latestTournament(env.DB)))
    if (!t) throw new TournamentError(options.tournament ? `There is no Tournament #${options.tournament}.` : 'No tournament has been played yet.')
    const matches = await loadMatches(env.DB, t.id)
    return reply(bracketMessage(t, matches, await getPlayersByIds(env.DB, idsIn(matches))))
  }
}

export const mymatch: Command = {
  definition: { name: 'mymatch', description: 'Show your current match and opponent' },
  async handle({ interaction, env }) {
    requireGuild(interaction)
    const me = await getActivePlayerByDiscordId(env.DB, userIdOf(interaction))
    if (!me) throw new TournamentError("You're not a tournament player.")
    const t = await getCurrentTournament(env.DB)
    if (!t) throw new TournamentError('No tournament is in progress right now.')
    const matches = await loadMatches(env.DB, t.id)
    const mine = matches.filter((m) => m.player1 === me.id || m.player2 === me.id)
    // A confirmed Round 3 match already decides this player's final place.
    const last = mine.find((m) => SLOTS[m.slot].winnerPlace && m.status === 'confirmed')
    const place = last ? SLOTS[last.slot].winnerPlace! + (last.winner === me.id ? 0 : 1) : null
    return ephemeral(myMatchText(t, mine, me.id, await getPlayersByIds(env.DB, idsIn(mine)), place))
  }
}

export const standings: Command = {
  definition: { name: 'standings', description: 'The overall leaderboard across all tournaments' },
  async handle({ interaction, env }) {
    requireGuild(interaction)
    const placements = await loadFinishedPlacements(env.DB)
    const active = await listPlayers(env.DB, { activeOnly: true })
    const ids = [...new Set([...active.map((p) => p.id), ...placements.map((p) => p.playerId)])]
    const rows = computeStandings(placements, await getPointsTable(env.DB), ids)
    const finished = new Set(placements.map((p) => p.tournamentId)).size
    return reply(standingsMessage(rows, await getPlayersByIds(env.DB, ids), new Set(active.map((p) => p.id)), finished))
  }
}

export const history: Command = {
  definition: {
    name: 'history',
    description: 'Past tournaments and their final placings',
    options: [
      tournamentOption('Show one tournament in detail'),
      { type: OptionType.INTEGER, name: 'page', description: 'Page of the list (10 per page)', min_value: 1 }
    ]
  },
  async handle({ interaction, env }) {
    requireGuild(interaction)
    const db = env.DB
    const { options } = parseCommand(interaction)

    if (options.tournament) {
      const t = await getTournamentByNumber(db, Number(options.tournament))
      if (!t) throw new TournamentError(`There is no Tournament #${options.tournament}.`)
      const matches = await loadMatches(db, t.id)
      const placements = t.status === 'finished' ? ((await placementsOf(db, [t.id])).get(t.id) ?? []) : []
      const players = await getPlayersByIds(db, [...idsIn(matches), ...placements.map((p) => p.playerId)])
      return reply(historyDetailMessage(t, placements, matches, players, await getPointsTable(db)))
    }

    const total = (await db.prepare("SELECT COUNT(*) AS n FROM tournaments WHERE status = 'finished'").first<number>('n')) ?? 0
    const pages = Math.ceil(total / PAGE_SIZE)
    const page = Math.min(Math.max(1, Number(options.page ?? 1)), Math.max(pages, 1))
    const { results } = await db
      .prepare("SELECT * FROM tournaments WHERE status = 'finished' ORDER BY number DESC LIMIT ? OFFSET ?")
      .bind(PAGE_SIZE, (page - 1) * PAGE_SIZE)
      .all<Tournament>()
    const byTournament = await placementsOf(db, results.map((t) => t.id))
    const entries = results.map((t) => ({ tournament: t, placements: byTournament.get(t.id) ?? [] }))
    const players = await getPlayersByIds(db, entries.flatMap((e) => e.placements.map((p) => p.playerId)))
    return reply(historyListMessage(entries, players, page, pages, await getCurrentTournament(db)))
  }
}

export const stats: Command = {
  definition: {
    name: 'stats',
    description: "A player's record, placements and head-to-head",
    options: [{ type: OptionType.USER, name: 'player', description: 'Whose stats (default: yours)' }]
  },
  async handle({ interaction, env }) {
    requireGuild(interaction)
    const db = env.DB
    const { options } = parseCommand(interaction)
    const userId = options.player ? String(options.player) : userIdOf(interaction)
    const player = await playerForUser(db, userId)
    if (!player) throw new TournamentError(`${mentionUser(userId)} has never been a tournament player.`)

    const { results } = await db
      .prepare("SELECT * FROM matches WHERE status = 'confirmed' AND (player1_id = ? OR player2_id = ?)")
      .bind(player.id, player.id)
      .all<{ player1_id: number; player2_id: number; winner_id: number; score_p1: number; score_p2: number }>()
    const matches = results.map((r) => ({
      player1: r.player1_id,
      player2: r.player2_id,
      winner: r.winner_id,
      scoreP1: r.score_p1,
      scoreP2: r.score_p2
    }))
    const placements = await loadFinishedPlacements(db)
    const s = computePlayerStats(player.id, matches, placements)
    const allIds = [...new Set([...placements.map((p) => p.playerId), player.id])]
    const standing = computeStandings(placements, await getPointsTable(db), allIds).find((r) => r.playerId === player.id)
    const players = await getPlayersByIds(db, [player.id, ...([...s.headToHead.keys()] as PlayerId[])])
    return reply(statsMessage(player, s, standing, players))
  }
}
