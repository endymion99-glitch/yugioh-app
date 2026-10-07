// The Round 1 draw reveal and the plain pairings post.
import type { MessagePayload } from '../discord/types'
import type { Pairs } from '../logic/bracket'
import { COLOR, mentionOf, nameOf, type PlayerLookup } from './common'

const HIDDEN = '❔ vs ❔'

/**
 * The frames of the reveal animation: an intro, then one more Round 1 match
 * uncovered per frame. Each frame replaces the previous one (message edit).
 */
export function revealFrames(number: number, pairs: Pairs, players: PlayerLookup): MessagePayload[] {
  const lines = (shown: number) =>
    pairs
      .map(([a, b], i) => `**Match ${i + 1}** · ${i < shown ? `${nameOf(players, a)} vs ${nameOf(players, b)}` : HIDDEN}`)
      .join('\n')
  const frame = (description: string, footer: string): MessagePayload => ({
    embeds: [{ title: `🎴 Tournament #${number} · The Draw`, description, color: COLOR, footer: { text: footer } }]
  })
  const frames = [frame(`Shuffling the 8 duelists…\n\n${lines(0)}`, 'Drawing Round 1')]
  for (let shown = 1; shown <= pairs.length; shown++) {
    frames.push(frame(lines(shown), shown < pairs.length ? 'Drawing Round 1' : 'Round 1 is set!'))
  }
  return frames
}

/** The message that tags all 8 players once the draw is out (mentions in edits don't ping). */
export function round1Announcement(number: number, pairs: Pairs, players: PlayerLookup, intro: string): MessagePayload {
  const lines = pairs.map(([a, b], i) => `**Match ${i + 1}:** ${mentionOf(players, a)} vs ${mentionOf(players, b)}`)
  const userIds = pairs.flat().map((id) => players.get(id)?.discord_user_id).filter((id): id is string => !!id)
  return {
    content: [
      intro,
      '',
      ...lines,
      '',
      `Round 1 of Tournament #${number} is ready. Play your match, then report it with \`/report\`. Good luck, duelists!`
    ].join('\n'),
    allowed_mentions: { users: userIds }
  }
}
