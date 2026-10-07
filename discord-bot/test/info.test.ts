import { describe, expect, it } from 'vitest'
import type { Env } from '../src/env'
import { discord } from './helpers/fakeDiscord'
import { MANUAL_SEATS, addEightPlayers, admin, makeTestEnv, member, run, setupServer } from './helpers/interactions'

// Same results as the finish tests: places 1 u1, 2 u5, 3 u3, 4 u7, 5 u2, 6 u6, 7 u4, 8 u8.
const T1: Array<[string, string]> = [
  ['M1', 'u1'], ['M2', 'u3'], ['M3', 'u5'], ['M4', 'u7'],
  ['WA', 'u1'], ['WB', 'u5'], ['LA', 'u2'], ['LB', 'u6'],
  ['P3', 'u3'], ['P5', 'u2'], ['P7', 'u4'], ['P1', 'u1']
]

async function started() {
  const env = makeTestEnv()
  await setupServer(env)
  await addEightPlayers(env)
  await run(env, admin, 'tournament', 'create-manual', MANUAL_SEATS)
  return env
}

async function play(env: Env, upTo = T1.length) {
  for (const [match, winner] of T1.slice(0, upTo)) {
    const r = await run(env, admin, 'result', 'override', { match, winner, ...(match === 'P1' ? { score: '2-1' } : {}) })
    await r.done
  }
}

const embed = (r: { data: any }) => r.data.embeds[0]

describe('/bracket', () => {
  it('shows every match and its status, publicly', async () => {
    const env = await started()
    await play(env, 2) // M1, M2 confirmed; WA and LA ready
    await run(env, member('u5'), 'report', null, { result: 'won' }) // M3 pending
    const r = await run(env, member('u8'), 'bracket', null)
    expect(r.ephemeral).toBe(false)
    const e = embed(r)
    expect(e.title).toBe('🗂️ Tournament #1 · Bracket')
    expect(e.description).toBe('In progress · 2/12 matches confirmed')
    const [r1, r2, r3] = e.fields
    expect(r1.value).toContain('**Round 1 · Match 1**\n✅ **P1** beat **P2**')
    expect(r1.value).toContain('**Round 1 · Match 3**\n📝 P5 vs P6 · reported, waiting for confirmation')
    expect(r1.value).toContain('**Round 1 · Match 4**\n⚔️ P7 vs P8 · ready to play')
    expect(r2.value).toContain("**Winners' Semi A**\n⚔️ P1 vs P3 · ready to play")
    expect(r2.value).toContain("**Winners' Semi B**\n🕓 TBD vs TBD · waiting for earlier matches")
    expect(r3.value).toContain('**Final (1st/2nd)** (Best of 3)\n🕓 TBD vs TBD')
    expect(r.data.allowed_mentions).toEqual({ parse: [] })
  })

  it('shows a finished tournament by number, and explains when there is none', async () => {
    const env = makeTestEnv()
    await setupServer(env)
    expect((await run(env, member('u1'), 'bracket', null)).content).toMatch(/No tournament has been played yet/)
    await addEightPlayers(env)
    await run(env, admin, 'tournament', 'create-manual', MANUAL_SEATS)
    await play(env)
    const r = await run(env, member('u1'), 'bracket', null, { tournament: 1 })
    expect(embed(r).description).toBe('Finished')
    expect((await run(env, member('u1'), 'bracket', null, { tournament: 9 })).content).toMatch(/no Tournament #9/)
  })
})

describe('/mymatch', () => {
  it('shows your playable match and opponent, privately', async () => {
    const env = await started()
    const r = await run(env, member('u2'), 'mymatch', null)
    expect(r.ephemeral).toBe(true)
    expect(r.content).toContain('**Tournament #1 · Round 1 · Match 1** (Best of 1)')
    expect(r.content).toContain('You vs <@u1> (P1)')
    expect(r.content).toMatch(/report the result with `\/report`/)
  })

  it('tells you what to do about a reported result', async () => {
    const env = await started()
    await run(env, member('u1'), 'report', null, { result: 'won' })
    expect((await run(env, member('u1'), 'mymatch', null)).content).toMatch(/Waiting for your opponent to confirm/)
    expect((await run(env, member('u2'), 'mymatch', null)).content).toMatch(/confirm or dispute it with the buttons/)
  })

  it('explains a match that is not ready yet, and your final place once you are done', async () => {
    const env = await started()
    await play(env, 1) // P1 beat P2
    const waiting = await run(env, member('u1'), 'mymatch', null)
    expect(waiting.content).toMatch(/Winners' Semi A\*\* \(Best of 1\)\nYour next match isn't ready yet/)
    await play(env, 11) // everything except the final
    expect((await run(env, member('u4'), 'mymatch', null)).content).toMatch(/finished \*\*7th\*\*/)
    expect((await run(env, member('stranger'), 'mymatch', null)).content).toMatch(/not a tournament player/)
  })
})

describe('/standings', () => {
  it('lists everyone by points with place counts, and handles a fresh start', async () => {
    const env = await started()
    const empty = await run(env, member('u1'), 'standings', null)
    expect(embed(empty).description).toContain('**1.** P1 · **0 pts** · 0 played')
    expect(embed(empty).description).toContain('**1.** P8 · **0 pts**') // all tied on 0: shared rank
    await play(env)
    discord.reset()
    const r = await run(env, member('u1'), 'standings', null)
    const lines = (embed(r).description as string).split('\n')
    expect(lines[0]).toBe('**1.** P1 · **10 pts** · 🥇×1 · 1 played')
    expect(lines[1]).toBe('**2.** P5 · **8 pts** · 🥈×1 · 1 played')
    expect(lines[7]).toBe('**8.** P8 · **1 pt** · 8th×1 · 1 played')
    expect(embed(r).footer.text).toMatch(/^1 finished tournament ·/)
  })
})

describe('/history', () => {
  it('lists finished tournaments with their podium', async () => {
    const env = await started()
    expect(embed(await run(env, member('u1'), 'history', null)).description).toMatch(/Tournament #1 is in progress.*No finished tournaments yet/s)
    await play(env)
    const r = await run(env, member('u1'), 'history', null)
    expect(embed(r).description).toMatch(/Tournament #2 is in progress/)
    expect(embed(r).description).toMatch(/\*\*#1\*\* · \d{4}-\d\d-\d\d\n🥇 P1 · 🥈 P5 · 🥉 P3/)
    expect(embed(r).footer.text).toBe('Page 1 of 1 · Details: /history tournament:<number>')
  })

  it('opens one tournament in detail', async () => {
    const env = await started()
    await play(env)
    const e = embed(await run(env, member('u1'), 'history', null, { tournament: 1 }))
    expect(e.title).toBe('📜 Tournament #1')
    expect(e.description).toContain('🥇 **P1** · 10 pts\n🥈 **P5** · 8 pts\n🥉 **P3** · 7 pts\n4th **P7** · 6 pts')
    expect(e.fields[2].value).toContain('**Final (1st/2nd):** ✅ **P1** beat **P5** 2-1')
    expect((await run(env, member('u1'), 'history', null, { tournament: 5 })).content).toMatch(/no Tournament #5/)
  })
})

describe('/stats', () => {
  it("shows a player's record, placements, head-to-head and standing", async () => {
    const env = await started()
    await play(env)
    const e = embed(await run(env, member('u1'), 'stats', null, { player: 'u5' }))
    expect(e.title).toBe('📈 P5')
    const field = (name: string) => e.fields.find((f: any) => f.name.startsWith(name)).value
    expect(field('Overall')).toBe('**8 pts** · #2 in the standings')
    expect(field('Tournaments')).toBe('1 played\nBest: 2nd · Average: 2.0')
    // P5: beat P6 (M3), beat P7 (WB), lost the final to P1 1-2.
    expect(field('Record')).toBe('Matches: **2-1** (67%)\nGames: 3-2')
    expect(field('Placements')).toBe('2nd: 1')
    expect(field('Head-to-head')).toContain('P1: **0-1**')
    expect(field('Head-to-head')).toContain('P6: **1-0**')
  })

  it('defaults to yourself and keeps former players', async () => {
    const env = await started()
    expect(embed(await run(env, member('u3'), 'stats', null)).title).toBe('📈 P3')
    await play(env, 1)
    // Swap out P2 (who lost M1): their record stays on their own player.
    await run(env, admin, 'player', 'swap', { old: 'u2', new: 'u9', name: 'Mai' })
    const e = embed(await run(env, member('u1'), 'stats', null, { player: 'u2' }))
    expect(e.title).toBe('📈 P2 (former player)')
    expect(e.fields.find((f: any) => f.name === 'Record').value).toMatch(/Matches: \*\*0-1\*\*/)
    expect((await run(env, member('u1'), 'stats', null, { player: 'nobody' })).content).toMatch(/never been a tournament player/)
  })
})
