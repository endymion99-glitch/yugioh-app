// The end-of-tournament summary (and the "Correction" version of it).
import type { Tournament } from '../db/tournaments'
import type { MessagePayload } from '../discord/types'
import { SLOTS, type MatchState, type Placement } from '../logic/bracket'
import { describeReward, pointsFor, type PointsTable, type RewardRow, type StandingRow } from '../logic/points'
import { COLOR, mentionOf, nameOf, type PlayerLookup } from './common'
import { resultLine } from './results'

const MEDALS = ['🥇', '🥈', '🥉']
const pts = (n: number) => `${n} pt${n === 1 ? '' : 's'}`

export function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return `${n}${suffix}`
}

export interface SummaryInput {
  tournament: Pick<Tournament, 'number'>
  placements: Placement[]
  matches: MatchState[]
  players: PlayerLookup
  standings: StandingRow[]
  points: PointsTable
  rewards: RewardRow[]
  correction: boolean
}

export function summaryMessage(s: SummaryInput): MessagePayload {
  const totals = new Map(s.standings.map((r) => [r.playerId, r]))
  const lines = s.placements.map((p) => {
    const reward = describeReward(
      s.rewards.find((r) => r.place === p.place) ?? { place: p.place, base_packs: 0, extra_packs: 0, chosen_cards: 0 }
    )
    const total = totals.get(p.playerId)
    return [
      `${MEDALS[p.place - 1] ?? '▫️'} **${ordinal(p.place)} · ${nameOf(s.players, p.playerId)}** ${mentionOf(s.players, p.playerId)}`,
      `+${pts(pointsFor(p.place, s.points))} · 🎁 ${reward.text}`,
      `Total: **${pts(total?.points ?? 0)}** · #${total?.rank ?? '?'} overall`
    ].join('\n')
  })
  const placementMatches = (['P1', 'P3', 'P5', 'P7'] as const).map((slot) => {
    const m = s.matches.find((x) => x.slot === slot)
    return `**${SLOTS[slot].name}:** ${m ? resultLine(m, s.players) : '-'}`
  })
  const winner = s.placements.find((p) => p.place === 1)
  return {
    content: s.correction
      ? `📝 **Correction:** the results of Tournament #${s.tournament.number} were changed. Here is the updated summary.`
      : `🏆 **Tournament #${s.tournament.number} is complete!** Congratulations to **${nameOf(s.players, winner?.playerId ?? null)}**!`,
    embeds: [
      {
        title: `${s.correction ? '📝 Correction · ' : '🏆 '}Tournament #${s.tournament.number} · Final Standings`,
        description: lines.join('\n\n'),
        color: COLOR,
        footer: { text: 'Totals and overall ranks include every finished tournament.' }
      },
      { title: 'Placement matches', description: placementMatches.join('\n'), color: COLOR }
    ]
  }
}
