// Messages for reported results, confirmations, disputes and admin overrides.
import type { StoredMatch, Tournament } from '../db/tournaments'
import { mentionRole } from '../discord/format'
import { ButtonStyle, buttonRow, type MessagePayload } from '../discord/types'
import { SLOTS, type MatchState, type PlayerId } from '../logic/bracket'
import { formatLabel, mentionOf, nameOf, type PlayerLookup } from './common'

export const matchTitle = (t: Pick<Tournament, 'number'>, m: Pick<MatchState, 'slot' | 'bestOf'>) =>
  `Tournament #${t.number} · ${SLOTS[m.slot].name} (${formatLabel(m.bestOf)})`

/** "**Yugi** beat **Kaiba** 2-1" (no score for Bo1). */
export function resultLine(m: MatchState, players: PlayerLookup): string {
  if (m.winner === null) return 'No result'
  const loser = m.winner === m.player1 ? m.player2 : m.player1
  const games = `${Math.max(m.scoreP1 ?? 0, m.scoreP2 ?? 0)}-${Math.min(m.scoreP1 ?? 0, m.scoreP2 ?? 0)}`
  return `**${nameOf(players, m.winner)}** beat **${nameOf(players, loser)}**${m.bestOf > 1 ? ` ${games}` : ''}`
}

export const opponentOf = (m: MatchState, playerId: PlayerId | null) => (m.player1 === playerId ? m.player2 : m.player1)

export const CLAIM_PREFIX = 'claim'

/** The public message with Confirm/Dispute buttons, pinging only the opponent. */
export function claimMessage(t: Tournament, m: StoredMatch, players: PlayerLookup, reporterId: PlayerId): MessagePayload {
  const opponent = opponentOf(m, reporterId)
  const opponentUser = opponent === null ? undefined : players.get(opponent)?.discord_user_id
  return {
    content: [
      `📝 **Result reported** · ${matchTitle(t, m)}`,
      `${nameOf(players, reporterId)} reports: ${resultLine(m, players)}.`,
      '',
      `${mentionOf(players, opponent)}, is that right? Confirm or dispute it below.`
    ].join('\n'),
    components: [
      buttonRow(
        { label: 'Confirm', style: ButtonStyle.SUCCESS, custom_id: `${CLAIM_PREFIX}:confirm:${m.id}` },
        { label: 'Dispute', style: ButtonStyle.DANGER, custom_id: `${CLAIM_PREFIX}:dispute:${m.id}` }
      )
    ],
    allowed_mentions: { users: opponentUser ? [opponentUser] : [] }
  }
}

export const confirmedMessage = (t: Tournament, m: MatchState, players: PlayerLookup, by: string): MessagePayload => ({
  content: `✅ **Confirmed** · ${matchTitle(t, m)}\n${resultLine(m, players)}. Confirmed by ${by}.`,
  components: []
})

export const disputedMessage = (t: Tournament, m: MatchState, players: PlayerLookup, by: string): MessagePayload => ({
  content: `⚠️ **Disputed** · ${matchTitle(t, m)}\nThe report said ${resultLine(m, players)}, but ${by} disputed it. An admin will settle it.`,
  components: []
})

export function adminNeededMessage(t: Tournament, m: MatchState, adminRoleId: string | null): MessagePayload {
  const who = adminRoleId ? mentionRole(adminRoleId) : 'Admins'
  return {
    content:
      `${who}, a result was disputed: **${matchTitle(t, m)}**.\n` +
      `Settle it with \`/result override\` (match: ${SLOTS[m.slot].name}).`,
    allowed_mentions: { roles: adminRoleId ? [adminRoleId] : [] }
  }
}

export const replacedMessage = (t: Tournament, m: MatchState): MessagePayload => ({
  content: `~~Result report for ${matchTitle(t, m)}~~\nThis report was replaced by a newer one.`,
  components: []
})

export const settledByAdminMessage = (t: Tournament, m: MatchState, players: PlayerLookup): MessagePayload => ({
  content: `🛠️ **Settled by an admin** · ${matchTitle(t, m)}\n${resultLine(m, players)}.`,
  components: []
})

export const cancelledMessage = (t: Tournament, m: MatchState): MessagePayload => ({
  content: `❌ ~~Result report for ${matchTitle(t, m)}~~\nCancelled: an earlier result in the bracket was corrected, so this match changed.`,
  components: []
})

export const OVERRIDE_PREFIX = 'ovr'

/** The private warning shown before an override that clears later results. */
export function overrideWarning(
  t: Tournament,
  m: MatchState,
  players: PlayerLookup,
  reset: MatchState[],
  confirmId: string
): MessagePayload {
  const names = reset.map(
    (r) =>
      `• ${SLOTS[r.slot].name}: ${resultLine(r, players)}${r.status === 'confirmed' ? '' : ' (reported, not confirmed yet)'}`
  )
  return {
    content: [
      `⚠️ Setting **${matchTitle(t, m)}** to ${resultLine(m, players)} changes who plays later.`,
      `**${reset.length} later match${reset.length === 1 ? '' : 'es'} will be reset** and need to be played or entered again:`,
      ...names,
      '',
      'Apply the change?'
    ].join('\n'),
    components: [
      buttonRow(
        { label: `Apply and reset ${reset.length}`, style: ButtonStyle.DANGER, custom_id: confirmId },
        { label: 'Cancel', style: ButtonStyle.SECONDARY, custom_id: `${OVERRIDE_PREFIX}:cancel` }
      )
    ]
  }
}
