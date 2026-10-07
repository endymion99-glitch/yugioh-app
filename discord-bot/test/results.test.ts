import { describe, expect, it } from 'vitest'
import { getCurrentTournament, loadMatches, type StoredMatch } from '../src/db/tournaments'
import { ResponseType } from '../src/discord/types'
import type { Env } from '../src/env'
import type { Slot } from '../src/logic/bracket'
import { discord } from './helpers/fakeDiscord'
import {
  ADMIN_ROLE,
  MANUAL_SEATS,
  TOURNAMENT_CHANNEL,
  addEightPlayers,
  admin,
  buttonIds,
  click,
  makeTestEnv,
  member,
  run,
  setupServer
} from './helpers/interactions'

const CHANNEL_MSGS = `/channels/${TOURNAMENT_CHANNEL}/messages`

async function started(opts: { r1BestOf3?: boolean } = {}) {
  const env = makeTestEnv()
  await setupServer(env)
  await addEightPlayers(env)
  if (opts.r1BestOf3) await run(env, admin, 'config', 'format', { stage: 'R1', best_of: 3 })
  await run(env, admin, 'tournament', 'create-manual', MANUAL_SEATS)
  discord.reset()
  return env
}

async function matchesOf(env: Env): Promise<Record<Slot, StoredMatch>> {
  const t = (await getCurrentTournament(env.DB)) ?? (await env.DB.prepare('SELECT * FROM tournaments ORDER BY id DESC').first<any>())
  return Object.fromEntries((await loadMatches(env.DB, t.id)).map((m) => [m.slot, m])) as Record<Slot, StoredMatch>
}

/** A player reports; returns the posted claim message (id + buttons). */
async function reportAs(env: Env, user: string, result: 'won' | 'lost', score?: string) {
  const before = discord.calls.length
  const r = await run(env, member(user), 'report', null, score ? { result, score } : { result })
  await r.done
  const post = discord.calls.slice(before).find((c) => c.method === 'POST' && c.path === CHANNEL_MSGS)
  return { reply: r, post, messageId: post ? `msg-${discord.calls.filter((c) => c.method === 'POST').indexOf(post) + 1}` : '' }
}

/** Reports and confirms a match: `winner` reports a win, `loser` confirms. */
async function play(env: Env, winner: string, loser: string, score?: string) {
  const { post, messageId } = await reportAs(env, winner, 'won', score)
  const [confirm] = buttonIds(post!.body)
  const r = await click(env, member(loser), confirm, messageId)
  await r.done
  return r
}

describe('/report', () => {
  it('posts the claim with Confirm/Dispute buttons and pings only the opponent', async () => {
    const env = await started()
    const { reply, post } = await reportAs(env, 'u1', 'won')
    expect(reply.ephemeral).toBe(true)
    expect(reply.content).toMatch(/Waiting for <@u2> to confirm/)
    expect(post!.body.content).toContain('Tournament #1 · Round 1 · Match 1 (Best of 1)')
    expect(post!.body.content).toContain('**P1** beat **P2**')
    expect(post!.body.allowed_mentions).toEqual({ users: ['u2'] })
    expect(buttonIds(post!.body)).toEqual(expect.arrayContaining([expect.stringMatching(/^claim:confirm:/), expect.stringMatching(/^claim:dispute:/)]))

    const m = (await matchesOf(env)).M1
    expect(m).toMatchObject({ status: 'pending', messageId: 'msg-1' })
    expect(m.winner).toBe(m.player1)
  })

  it('"I lost" makes the opponent the winner', async () => {
    const env = await started()
    const { post } = await reportAs(env, 'u2', 'lost')
    expect(post!.body.content).toContain('**P1** beat **P2**')
    expect(post!.body.allowed_mentions).toEqual({ users: ['u1'] })
  })

  it('checks the score against the match format', async () => {
    const env = await started({ r1BestOf3: true })
    expect((await reportAs(env, 'u1', 'won')).reply.content).toMatch(/Best of 3. Please include the score/)
    expect((await reportAs(env, 'u1', 'won', '1-0')).reply.content).toMatch(/2-0 or 2-1/)
    const ok = await reportAs(env, 'u1', 'won', '2-1')
    expect(ok.post!.body.content).toContain('**P1** beat **P2** 2-1')
  })

  it('gives friendly errors', async () => {
    const env = makeTestEnv()
    await setupServer(env)
    await addEightPlayers(env)
    expect((await run(env, member('stranger'), 'report', null, { result: 'won' })).content).toMatch(/not a tournament player/)
    expect((await run(env, member('u1'), 'report', null, { result: 'won' })).content).toMatch(/No tournament is in progress/)

    await run(env, admin, 'tournament', 'create-manual', MANUAL_SEATS)
    await play(env, 'u1', 'u2')
    expect((await run(env, member('u2'), 'report', null, { result: 'won' })).content).toMatch(/Losers' Semi A\) isn't ready yet/)
  })

  it('a new report replaces a pending one and retires the old buttons', async () => {
    const env = await started()
    const first = await reportAs(env, 'u1', 'won')
    const second = await reportAs(env, 'u2', 'won')
    expect(discord.find(`${CHANNEL_MSGS}/${first.messageId}`, 'PATCH')[0].body.content).toMatch(/replaced by a newer one/)
    const [confirmOld] = buttonIds(first.post!.body)
    expect((await click(env, member('u2'), confirmOld, first.messageId)).content).toMatch(/no longer waiting/)
    expect((await matchesOf(env)).M1.messageId).toBe(second.messageId)
  })
})

describe('Confirm / Dispute buttons', () => {
  it('only the opponent (or an admin) can answer', async () => {
    const env = await started()
    const { post, messageId } = await reportAs(env, 'u1', 'won')
    const [confirm] = buttonIds(post!.body)
    expect((await click(env, member('u1'), confirm, messageId)).content).toMatch(/You reported this result/)
    expect((await click(env, member('u3'), confirm, messageId)).content).toMatch(/Only <@u2> or an admin/)
    expect((await matchesOf(env)).M1.status).toBe('pending')
  })

  it('confirming makes the result final and announces the next match with pings', async () => {
    const env = await started()
    const r = await play(env, 'u1', 'u2')
    expect(r.type).toBe(ResponseType.UPDATE_MESSAGE)
    expect(r.content).toMatch(/Confirmed\*\* · Tournament #1/)
    expect(r.data.components).toEqual([])
    expect((await matchesOf(env)).M1.status).toBe('confirmed')

    discord.reset()
    await play(env, 'u3', 'u4') // M1 + M2 done: Winners' Semi A and Losers' Semi A are ready
    const announce = discord.find(CHANNEL_MSGS, 'POST').find((c) => c.body.content.includes('New matches are ready'))!
    expect(announce.body.content).toContain("Winners' Semi A** (Best of 1)\n<@u1> vs <@u3>")
    expect(announce.body.content).toContain("Losers' Semi A** (Best of 1)\n<@u2> vs <@u4>")
    expect(announce.body.allowed_mentions.users.sort()).toEqual(['u1', 'u2', 'u3', 'u4'])
    const ms = await matchesOf(env)
    expect(ms.WA.status).toBe('ready')
    expect(ms.WA.announcedAt).toBeTruthy()
  })

  it('an admin can confirm on behalf of the opponent', async () => {
    const env = await started()
    const { post, messageId } = await reportAs(env, 'u1', 'won')
    const r = await click(env, admin, buttonIds(post!.body)[0], messageId)
    expect(r.content).toMatch(/Confirmed by <@admin-user>/)
  })

  it('disputing pings the admin role and blocks further reports until an admin settles it', async () => {
    const env = await started()
    const { post, messageId } = await reportAs(env, 'u1', 'won')
    const r = await click(env, member('u2'), buttonIds(post!.body)[1], messageId)
    await r.done
    expect(r.content).toMatch(/Disputed/)
    const ping = discord.find('/webhooks/app-id/tok', 'POST')[0]
    expect(ping.body.content).toContain(`<@&${ADMIN_ROLE}>`)
    expect(ping.body.allowed_mentions).toEqual({ roles: [ADMIN_ROLE] })
    expect((await matchesOf(env)).M1.status).toBe('disputed')
    expect((await run(env, member('u1'), 'report', null, { result: 'won' })).content).toMatch(/disputed/)

    discord.reset()
    const settle = await run(env, admin, 'result', 'override', { match: 'M1', winner: 'u2' })
    await settle.done
    expect(settle.content).toMatch(/Round 1 · Match 1\*\*: \*\*P2\*\* beat \*\*P1\*\*/)
    expect(discord.find(`${CHANNEL_MSGS}/${messageId}`, 'PATCH')[0].body.content).toMatch(/Settled by an admin/)
    const m1 = (await matchesOf(env)).M1
    expect(m1).toMatchObject({ status: 'confirmed', reportedBy: null })
  })
})

describe('/result override', () => {
  it('sets results silently by default, so catching up does not ping anyone', async () => {
    const env = await started()
    await run(env, admin, 'result', 'override', { match: 'M1', winner: 'u1' })
    const r = await run(env, admin, 'result', 'override', { match: 'M2', winner: 'u3' })
    await r.done
    expect(r.content).toMatch(/Now ready: Winners' Semi A \(P1 vs P3\), Losers' Semi A \(P2 vs P4\)/)
    expect(r.content).toMatch(/Announced silently/)
    const announce = discord.find(CHANNEL_MSGS, 'POST').at(-1)!
    expect(announce.body.content).toContain('<@u1> vs <@u3>')
    expect(announce.body.allowed_mentions).toEqual({ parse: [] })
  })

  it('pings when ping_players is set', async () => {
    const env = await started()
    await run(env, admin, 'result', 'override', { match: 'M1', winner: 'u1' })
    const r = await run(env, admin, 'result', 'override', { match: 'M2', winner: 'u3', ping_players: true })
    await r.done
    expect(discord.find(CHANNEL_MSGS, 'POST').at(-1)!.body.allowed_mentions.users).toHaveLength(4)
  })

  it('refuses invalid overrides with friendly messages', async () => {
    const env = await started()
    expect((await run(env, admin, 'result', 'override', { match: 'WA', winner: 'u1' })).content).toMatch(/can't have a result yet/)
    expect((await run(env, admin, 'result', 'override', { match: 'M1', winner: 'u3' })).content).toMatch(
      /<@u3> isn't playing in Round 1 · Match 1. It's P1 vs P2/
    )
    expect((await run(env, admin, 'result', 'override', { match: 'M1', winner: 'u1', tournament: 7 })).content).toMatch(/no Tournament #7/)
    expect((await run(env, member('u1'), 'result', 'override', { match: 'M1', winner: 'u1' })).content).toMatch(/Only members with/)
    await run(env, admin, 'result', 'override', { match: 'M1', winner: 'u1' })
    expect((await run(env, admin, 'result', 'override', { match: 'M1', winner: 'u1' })).content).toMatch(/already the result/)
  })

  it('a score-only change applies directly without a warning', async () => {
    const env = await started({ r1BestOf3: true })
    await run(env, admin, 'result', 'override', { match: 'M1', winner: 'u1', score: '2-0' })
    await run(env, admin, 'result', 'override', { match: 'M2', winner: 'u3', score: '2-0' })
    await run(env, admin, 'result', 'override', { match: 'WA', winner: 'u1' })
    const r = await run(env, admin, 'result', 'override', { match: 'M1', winner: 'u1', score: '2-1' })
    expect(r.content).toMatch(/^Done\./)
    expect((await matchesOf(env)).WA.status).toBe('confirmed')
  })

  describe('when later results would be reset', () => {
    async function withRound2() {
      const env = await started()
      for (const [match, winner] of [['M1', 'u1'], ['M2', 'u3'], ['M3', 'u5'], ['M4', 'u7'], ['WA', 'u1'], ['LA', 'u2']]) {
        await run(env, admin, 'result', 'override', { match, winner })
      }
      return env
    }

    it('warns with the count and the matches, and changes nothing yet', async () => {
      const env = await withRound2()
      const r = await run(env, admin, 'result', 'override', { match: 'M1', winner: 'u2' })
      expect(r.ephemeral).toBe(true)
      expect(r.content).toMatch(/2 later matches will be reset/)
      expect(r.content).toContain("Winners' Semi A: **P1** beat **P3**")
      expect(r.content).toContain("Losers' Semi A: **P2** beat **P4**")
      expect(buttonIds(r.data)).toEqual([expect.stringMatching(/^ovr:apply:/), 'ovr:cancel'])
      expect((await matchesOf(env)).M1.winner).toBe((await matchesOf(env)).M1.player1)
    })

    it('Apply resets them and recalculates; Cancel does nothing', async () => {
      const env = await withRound2()
      const warning = await run(env, admin, 'result', 'override', { match: 'M1', winner: 'u2' })
      const [apply, cancel] = buttonIds(warning.data)
      expect((await click(env, admin, cancel, 'eph')).content).toMatch(/Cancelled/)

      const r = await click(env, admin, apply, 'eph')
      await r.done
      expect(r.type).toBe(ResponseType.UPDATE_MESSAGE)
      expect(r.content).toMatch(/Reset 2 later match\(es\): Winners' Semi A, Losers' Semi A/)
      const ms = await matchesOf(env)
      expect(ms.WA).toMatchObject({ status: 'ready', winner: null })
      expect(ms.LA).toMatchObject({ status: 'ready', winner: null })
      // The corrected pairings: P2 (new M1 winner) meets P3; P1 drops to the losers' side.
      const ids = await env.DB.prepare('SELECT id, discord_user_id FROM players').all<any>()
      const byUser = Object.fromEntries(ids.results.map((p) => [p.discord_user_id, p.id]))
      expect([ms.WA.player1, ms.WA.player2]).toEqual([byUser.u2, byUser.u3])
      expect([ms.LA.player1, ms.LA.player2]).toEqual([byUser.u1, byUser.u4])
    })

    it('a stale Apply button is refused if the bracket changed in the meantime', async () => {
      const env = await withRound2()
      const warning = await run(env, admin, 'result', 'override', { match: 'M1', winner: 'u2' })
      await run(env, admin, 'result', 'override', { match: 'M3', winner: 'u6' })
      expect((await click(env, admin, buttonIds(warning.data)[0], 'eph')).content).toMatch(/bracket changed/)
    })

    it('only admins can press Apply', async () => {
      const env = await withRound2()
      const warning = await run(env, admin, 'result', 'override', { match: 'M1', winner: 'u2' })
      expect((await click(env, member('u1'), buttonIds(warning.data)[0], 'eph')).content).toMatch(/Only members with/)
    })

    it('a pending report in a reset match is cancelled', async () => {
      const env = await withRound2()
      const { messageId } = await reportAs(env, 'u5', 'won') // WB: P5 v P7, pending
      const warning = await run(env, admin, 'result', 'override', { match: 'M3', winner: 'u6' })
      expect(warning.content).toMatch(/1 later match will be reset/)
      expect(warning.content).toContain("Winners' Semi B: **P5** beat **P7** (reported, not confirmed yet)")
      const r = await click(env, admin, buttonIds(warning.data)[0], 'eph')
      await r.done
      expect(discord.find(`${CHANNEL_MSGS}/${messageId}`, 'PATCH')[0].body.content).toMatch(/Cancelled: an earlier result/)
    })
  })

  it('correcting a finished tournament reopens it for admin corrections', async () => {
    const env = await started()
    const results: Array<[string, string]> = [
      ['M1', 'u1'], ['M2', 'u3'], ['M3', 'u5'], ['M4', 'u7'],
      ['WA', 'u1'], ['WB', 'u5'], ['LA', 'u2'], ['LB', 'u6'],
      ['P1', 'u1'], ['P3', 'u3'], ['P5', 'u2'], ['P7', 'u4']
    ]
    for (const [match, winner] of results) {
      await run(env, admin, 'result', 'override', { match, winner, ...(match === 'P1' ? { score: '2-0' } : {}) })
    }
    // Finishing tournaments (placements, summary, next draw) is build step 7; simulate it here.
    const t = (await getCurrentTournament(env.DB))!
    await env.DB.prepare("UPDATE tournaments SET status = 'finished' WHERE id = ?").bind(t.id).run()
    await env.DB.prepare('INSERT INTO placements (tournament_id, player_id, place) VALUES (?, 1, 1)').bind(t.id).run()

    discord.reset()
    const warning = await run(env, admin, 'result', 'override', { match: 'M1', winner: 'u2', tournament: 1 })
    expect(warning.content).toMatch(/6 later matches will be reset/)
    const r = await click(env, admin, buttonIds(warning.data)[0], 'eph')
    await r.done
    expect(r.content).toMatch(/Tournament #1 is open for corrections/)
    const status = await env.DB.prepare('SELECT status FROM tournaments WHERE id = ?').bind(t.id).first('status')
    expect(status).toBe('correcting')
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM placements').first('n')).toBe(0)
    // No "match ready" posts for a past tournament being corrected.
    expect(discord.find(CHANNEL_MSGS, 'POST')).toHaveLength(0)
    // Players can't /report in it: it isn't the tournament in progress.
    expect((await run(env, member('u2'), 'report', null, { result: 'won' })).content).toMatch(/No tournament is in progress/)
  })
})
