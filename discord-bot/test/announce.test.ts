import { describe, expect, it } from 'vitest'
import type { StoredMatch, Tournament } from '../src/db/tournaments'
import { matchReadyMessage } from '../src/views/announce'

const tournament = { id: 1, number: 4 } as Tournament
const players = new Map([
  [1, { name: 'Yugi', discord_user_id: 'u1' }],
  [2, { name: 'Kaiba', discord_user_id: 'u2' }],
  [3, { name: 'Joey', discord_user_id: 'u3' }],
  [4, { name: 'Mai', discord_user_id: 'u4' }]
])
const match = (slot: string, p1: number, p2: number, bestOf = 1) =>
  ({ slot, player1: p1, player2: p2, bestOf, status: 'ready' }) as StoredMatch

describe('matchReadyMessage', () => {
  it('names the tournament, stage and format, and tags both players', () => {
    const msg = matchReadyMessage(tournament, [match('WA', 1, 2)], players)
    expect(msg.content).toContain("**Tournament #4 · Winners' Semi A** (Best of 1)")
    expect(msg.content).toContain('<@u1> vs <@u2>')
    expect(msg.allowed_mentions).toEqual({ users: ['u1', 'u2'] })
  })

  it('can announce several matches at once', () => {
    const msg = matchReadyMessage(tournament, [match('P1', 1, 2, 3), match('P3', 3, 4)], players)
    expect(msg.content).toMatch(/New matches are ready/)
    expect(msg.content).toContain('Final (1st/2nd)** (Best of 3)')
    expect(msg.content).toContain('3rd/4th Place Match** (Best of 1)')
    expect(msg.allowed_mentions!.users).toEqual(['u1', 'u2', 'u3', 'u4'])
  })
})
