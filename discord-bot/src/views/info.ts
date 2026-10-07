// Messages for /bracket, /mymatch, /standings, /history and /stats.
import type { Player } from '../db/players'
import type { StoredMatch, Tournament } from '../db/tournaments'
import type { MessagePayload } from '../discord/types'
import { SLOTS, type MatchState, type Placement, type PlayerId, type Slot } from '../logic/bracket'
import { pointsFor, type PointsTable, type StandingRow } from '../logic/points'
import type { PlayerStats } from '../logic/stats'
import { COLOR, formatLabel, mentionOf, nameOf, type PlayerLookup } from './common'
import { resultLine } from './results'
import { ordinal } from './summary'

const MEDALS = ['🥇', '🥈', '🥉']
const medal = (place: number) => MEDALS[place - 1] ?? `${ordinal(place)}`
const pts = (n: number) => `${n} pt${n === 1 ? '' : 's'}`

const ROUNDS: Array<{ name: string; slots: Slot[] }> = [
  { name: 'Round 1', slots: ['M1', 'M2', 'M3', 'M4'] },
  { name: 'Round 2 · Semis', slots: ['WA', 'WB', 'LA', 'LB'] },
  { name: 'Round 3 · Placement matches', slots: ['P1', 'P3', 'P5', 'P7'] }
]

export function statusLabel(t: Tournament, matches: MatchState[]): string {
  const done = matches.filter((m) => m.status === 'confirmed').length
  if (t.status === 'finished') return 'Finished'
  if (t.status === 'correcting') return `Being corrected by an admin · ${done}/12 results`
  return `In progress · ${done}/12 matches confirmed`
}

/** One line describing a match and where it stands. */
export function matchLine(m: MatchState, players: PlayerLookup): string {
  const vs = `${nameOf(players, m.player1)} vs ${nameOf(players, m.player2)}`
  switch (m.status) {
    case 'confirmed':
      return `✅ ${resultLine(m, players)}`
    case 'pending':
      return `📝 ${vs} · reported, waiting for confirmation`
    case 'disputed':
      return `⚠️ ${vs} · disputed, waiting for an admin`
    case 'ready':
      return `⚔️ ${vs} · ready to play`
    default:
      return `🕓 ${vs} · waiting for earlier matches`
  }
}

export function bracketMessage(t: Tournament, matches: MatchState[], players: PlayerLookup): MessagePayload {
  const bySlot = new Map(matches.map((m) => [m.slot, m]))
  return {
    embeds: [
      {
        title: `🗂️ Tournament #${t.number} · Bracket`,
        description: statusLabel(t, matches),
        color: COLOR,
        fields: ROUNDS.map((round) => ({
          name: round.name,
          value: round.slots
            .map((slot) => {
              const m = bySlot.get(slot)
              if (!m) return `**${SLOTS[slot].name}**: -`
              const format = m.bestOf > 1 ? ` (${formatLabel(m.bestOf)})` : ''
              return `**${SLOTS[slot].name}**${format}\n${matchLine(m, players)}`
            })
            .join('\n')
        })),
        footer: { text: t.status === 'finished' ? `Final standings: /history tournament:${t.number}` : 'Report your match with /report' }
      }
    ]
  }
}

/** The private /mymatch answer. */
export function myMatchText(t: Tournament, mine: StoredMatch[], me: PlayerId, players: PlayerLookup, place: number | null): string {
  const current = mine.find((m) => m.status !== 'confirmed' && m.status !== 'waiting')
  const header = (m: StoredMatch) => `**Tournament #${t.number} · ${SLOTS[m.slot].name}** (${formatLabel(m.bestOf)})`
  const opponentOf = (m: StoredMatch) => (m.player1 === me ? m.player2 : m.player1)
  if (current) {
    const opp = opponentOf(current)
    const vs = `You vs ${mentionOf(players, opp)} (${nameOf(players, opp)})`
    if (current.status === 'ready') return `${header(current)}\n${vs}\nPlay it, then report the result with \`/report\`.`
    if (current.status === 'disputed') return `${header(current)}\n${vs}\nThe result is disputed. An admin will settle it.`
    const reportedByMe = current.reportedBy === me
    return `${header(current)}\n${vs}\nA result was reported (${resultLine(current, players)}). ${
      reportedByMe ? 'Waiting for your opponent to confirm it.' : 'Please confirm or dispute it with the buttons in the tournament channel.'
    }`
  }
  const next = mine.find((m) => m.status === 'waiting')
  if (next) {
    const known = opponentOf(next)
    return `${header(next)}\nYour next match isn't ready yet: it starts once the matches before it are finished.${
      known !== null ? ` You'll play ${nameOf(players, known)}.` : ''
    }`
  }
  if (place !== null) return `You've played all your matches in Tournament #${t.number} and finished **${ordinal(place)}**. 🎉`
  return `You've played all your matches in Tournament #${t.number}.`
}

export function standingsMessage(rows: StandingRow[], players: PlayerLookup, activeIds: Set<PlayerId>, finished: number): MessagePayload {
  const lines = rows.map((r) => {
    const counts = r.placeCounts
      .map((n, i) => (n ? `${medal(i + 1)}×${n}` : ''))
      .filter(Boolean)
      .join(' ')
    const former = activeIds.has(r.playerId) ? '' : ' _(former)_'
    return `**${r.rank}.** ${nameOf(players, r.playerId)}${former} · **${pts(r.points)}**${counts ? ` · ${counts}` : ''} · ${r.tournaments} played`
  })
  return {
    embeds: [
      {
        title: '📊 Standings',
        description: lines.length ? lines.join('\n') : 'No players yet.',
        color: COLOR,
        footer: {
          text: `${finished} finished tournament${finished === 1 ? '' : 's'} · Ties: most 1st places, then 2nd, and so on. Still tied = shared rank.`
        }
      }
    ]
  }
}

export interface HistoryEntry {
  tournament: Tournament
  placements: Placement[]
}

export function historyListMessage(entries: HistoryEntry[], players: PlayerLookup, page: number, pages: number, current: Tournament | null): MessagePayload {
  const lines = entries.map(({ tournament: t, placements }) => {
    const podium = placements
      .filter((p) => p.place <= 3)
      .sort((a, b) => a.place - b.place)
      .map((p) => `${medal(p.place)} ${nameOf(players, p.playerId)}`)
      .join(' · ')
    const date = t.finished_at ? ` · ${t.finished_at.slice(0, 10)}` : ''
    return `**#${t.number}**${date}\n${podium}`
  })
  const intro = current ? `Tournament #${current.number} is in progress: see \`/bracket\`.\n\n` : ''
  return {
    embeds: [
      {
        title: '📜 Tournament history',
        description: intro + (lines.length ? lines.join('\n\n') : 'No finished tournaments yet.'),
        color: COLOR,
        footer: { text: `Page ${page} of ${Math.max(pages, 1)} · Details: /history tournament:<number>` }
      }
    ]
  }
}

export function historyDetailMessage(
  t: Tournament,
  placements: Placement[],
  matches: MatchState[],
  players: PlayerLookup,
  points: PointsTable
): MessagePayload {
  const bySlot = new Map(matches.map((m) => [m.slot, m]))
  const standings = placements
    .sort((a, b) => a.place - b.place)
    .map((p) => `${medal(p.place)} **${nameOf(players, p.playerId)}** · ${pts(pointsFor(p.place, points))}`)
  return {
    embeds: [
      {
        title: `📜 Tournament #${t.number}`,
        description: [
          statusLabel(t, matches) + (t.finished_at ? ` · ${t.finished_at.slice(0, 10)}` : ''),
          '',
          standings.length ? standings.join('\n') : '_No final standings (the tournament is not finished)._'
        ].join('\n'),
        color: COLOR,
        fields: ROUNDS.map((round) => ({
          name: round.name,
          value: round.slots.map((slot) => `**${SLOTS[slot].name}:** ${bySlot.get(slot) ? matchLine(bySlot.get(slot)!, players) : '-'}`).join('\n')
        }))
      }
    ]
  }
}

export function statsMessage(
  player: Player,
  stats: PlayerStats,
  standing: StandingRow | undefined,
  players: PlayerLookup
): MessagePayload {
  const pct = (w: number, l: number) => (w + l ? ` (${Math.round((100 * w) / (w + l))}%)` : '')
  const placeLine = stats.placeCounts
    .map((n, i) => (n ? `${ordinal(i + 1)}: ${n}` : ''))
    .filter(Boolean)
    .join(' · ')
  const h2h = [...stats.headToHead]
    .map(([id, r]) => ({ name: nameOf(players, id), ...r }))
    .sort((a, b) => b.won + b.lost - (a.won + a.lost) || a.name.localeCompare(b.name))
    .map((r) => `${r.name}: **${r.won}-${r.lost}**`)
  return {
    embeds: [
      {
        title: `📈 ${nameOf(players, player.id)}${player.active ? '' : ' (former player)'}`,
        description: mentionOf(players, player.id),
        color: COLOR,
        fields: [
          {
            name: 'Overall',
            value: standing ? `**${pts(standing.points)}** · #${standing.rank} in the standings` : 'No points yet',
            inline: true
          },
          {
            name: 'Tournaments',
            value: `${stats.tournaments} played${
              stats.best !== null ? `\nBest: ${ordinal(stats.best)} · Average: ${stats.average!.toFixed(1)}` : ''
            }`,
            inline: true
          },
          {
            name: 'Record',
            value: `Matches: **${stats.matches.won}-${stats.matches.lost}**${pct(stats.matches.won, stats.matches.lost)}\nGames: ${stats.games.won}-${stats.games.lost}`,
            inline: true
          },
          { name: 'Placements', value: placeLine || 'None yet' },
          { name: 'Head-to-head (wins-losses)', value: (h2h.join('\n') || 'No matches played yet').slice(0, 1024) }
        ]
      }
    ]
  }
}
