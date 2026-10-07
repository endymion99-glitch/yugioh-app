// Admin results (/result override), shared by the command and its "Apply" button.
import { getPlayersByIds } from '../db/players'
import { loadMatches, loadSubstitutions, type Tournament } from '../db/tournaments'
import { SLOTS, applyResult, type ResultInput, type Slot } from '../logic/bracket'
import type { Env } from '../env'
import { resultLine } from '../views/results'
import { nameOf } from '../views/common'
import { commitResult } from './results'

export interface OverrideOutcome {
  /** Private summary for the admin. */
  summary: string
  followUp: () => Promise<void>
}

/** Applies an admin result, recalculating the bracket from there on. */
export async function applyOverride(
  env: Env,
  tournament: Tournament,
  slot: Slot,
  result: ResultInput,
  ping: boolean
): Promise<OverrideOutcome> {
  const before = await loadMatches(env.DB, tournament.id)
  const subs = await loadSubstitutions(env.DB, tournament.id)
  const resolved = applyResult(before, slot, result, subs)
  const { reopened, complete, followUp } = await commitResult(env, tournament, before, resolved, slot, { byAdmin: true, ping })

  const players = await getPlayersByIds(
    env.DB,
    resolved.matches.flatMap((m) => [m.player1, m.player2]).filter((id): id is number => id !== null)
  )
  const set = resolved.matches.find((m) => m.slot === slot)!
  const lines = [`Done. **Tournament #${tournament.number} · ${SLOTS[slot].name}**: ${resultLine(set, players)}.`]
  if (resolved.reset.length) {
    lines.push(`Reset ${resolved.reset.length} later match(es): ${resolved.reset.map((s) => SLOTS[s].name).join(', ')}.`)
  }
  const ready = resolved.matches.filter((m) => resolved.becameReady.includes(m.slot))
  if (ready.length) {
    lines.push(
      `Now ready: ${ready.map((m) => `${SLOTS[m.slot].name} (${nameOf(players, m.player1)} vs ${nameOf(players, m.player2)})`).join(', ')}.`
    )
    if (tournament.status === 'in_progress') {
      lines.push(ping ? 'The players were notified.' : 'Announced silently (nobody was notified).')
    }
  }
  if (reopened || tournament.status === 'correcting') {
    lines.push(
      complete
        ? `All 12 matches of Tournament #${tournament.number} have results again.`
        : `Tournament #${tournament.number} is open for corrections. Enter the remaining matches with \`/result override tournament:${tournament.number}\`. When all 12 are set again, the corrected results are posted.`
    )
  }
  return { summary: lines.join('\n'), followUp }
}
