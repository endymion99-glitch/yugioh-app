import { describe, expect, it } from 'vitest'
import { getPlayersByIds } from '../src/db/players'
import { getCurrentTournament, getTournamentByNumber, loadMatches } from '../src/db/tournaments'
import type { Env } from '../src/env'
import { SLOT_ORDER } from '../src/logic/bracket'
import { onTournamentComplete } from '../src/services/finish'
import { discord } from './helpers/fakeDiscord'
import {
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

// Tournament #1 (manual seats u1 v u2, u3 v u4, u5 v u6, u7 v u8) played out so that the
// final places are: 1 u1, 2 u5, 3 u3, 4 u7, 5 u2, 6 u6, 7 u4, 8 u8.
const T1_RESULTS: Array<[string, string]> = [
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

async function override(env: Env, match: string, winner: string, extra: Record<string, string | number | boolean> = {}) {
  const r = await run(env, admin, 'result', 'override', { match, winner, ...(match === 'P1' ? { score: '2-0' } : {}), ...extra })
  await r.done
  return r
}

async function playTournament1(env: Env, upTo = T1_RESULTS.length) {
  for (const [match, winner] of T1_RESULTS.slice(0, upTo)) await override(env, match, winner)
}

/** Plays out whatever tournament is in progress: player 1 of every match wins. */
async function playOutCurrent(env: Env) {
  const t = (await getCurrentTournament(env.DB))!
  for (const slot of SLOT_ORDER) {
    const m = (await loadMatches(env.DB, t.id)).find((x) => x.slot === slot)!
    const p1 = (await getPlayersByIds(env.DB, [m.player1!])).get(m.player1!)!
    await override(env, slot, p1.discord_user_id)
  }
  return t
}

const summaries = () => discord.find(CHANNEL_MSGS, 'POST').filter((c) => c.body.embeds?.[0]?.title?.includes('Final Standings'))
const tournamentCount = (env: Env) => env.DB.prepare('SELECT COUNT(*) AS n FROM tournaments').first<number>('n')

describe('finishing a tournament', () => {
  it('posts the summary when the 12th match is confirmed, then draws the next tournament', async () => {
    const env = await started()
    await playTournament1(env, 11)
    expect(summaries()).toHaveLength(0)
    discord.reset()
    await override(env, 'P1', 'u1')

    const [summary] = summaries()
    expect(summary.body.content).toMatch(/Tournament #1 is complete!\*\* Congratulations to \*\*P1\*\*/)
    expect(summary.body.allowed_mentions).toEqual({ parse: [] })
    const text = summary.body.embeds[0].description as string
    const order = [...text.matchAll(/\*\*(\d)(?:st|nd|rd|th) · (P\d)\*\*/g)].map((m) => `${m[1]}:${m[2]}`)
    expect(order).toEqual(['1:P1', '2:P5', '3:P3', '4:P7', '5:P2', '6:P6', '7:P4', '8:P8'])
    expect(text).toContain('🥇 **1st · P1** <@u1>\n+10 pts · 🎁 10 packs + 4 cards of your choice\nTotal: **10 pts** · #1 overall')
    expect(text).toContain('**4th · P7** <@u7>\n+6 pts · 🎁 10 packs + 1 card of your choice')
    expect(text).toContain('**6th · P6** <@u6>\n+4 pts · 🎁 10 packs + 6 extra packs (16 packs)\nTotal: **4 pts** · #6 overall')
    expect(text).toContain('**8th · P8** <@u8>\n+1 pt · 🎁 10 packs + 10 extra packs (20 packs)')
    const h2h = summary.body.embeds[1].description as string
    expect(h2h).toContain('**Final (1st/2nd):** **P1** beat **P5** 2-0')
    expect(h2h).toContain('**7th/8th Place Match:** **P4** beat **P8**')

    // Saved: finished with 8 placements and the summary's message id.
    const t1 = (await getTournamentByNumber(env.DB, 1))!
    expect(t1.status).toBe('finished')
    expect(t1.finished_at).toBeTruthy()
    expect(t1.summary_message_id).toBeTruthy()
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM placements WHERE tournament_id = ?').bind(t1.id).first('n')).toBe(8)

    // ...and Tournament #2 was drawn right after, with the reveal, tagging everyone.
    const posts = discord.find(CHANNEL_MSGS, 'POST')
    expect(posts.indexOf(summary)).toBeLessThan(posts.length - 2)
    expect(posts.at(-1)!.body.content).toMatch(/Tournament #2 begins/)
    expect(posts.at(-1)!.body.allowed_mentions.users).toHaveLength(8)
    expect(discord.find(CHANNEL_MSGS + '/', 'PATCH').length).toBeGreaterThanOrEqual(4)
    expect((await getCurrentTournament(env.DB))!.number).toBe(2)
  })

  it('also finishes when the last result comes from a player report', async () => {
    const env = await started()
    await playTournament1(env, 11)
    const report = await run(env, member('u1'), 'report', null, { result: 'won', score: '2-1' })
    await report.done
    const claim = discord.find(CHANNEL_MSGS, 'POST').at(-1)!
    const messageId = `msg-${discord.calls.filter((c) => c.method === 'POST').indexOf(claim) + 1}`
    const confirm = await click(env, member('u5'), buttonIds(claim.body)[0], messageId)
    await confirm.done
    expect(summaries()).toHaveLength(1)
    expect((await getCurrentTournament(env.DB))!.number).toBe(2)
  })

  it('accumulates totals across tournaments, with the tiebreaks', async () => {
    const env = await started()
    await playTournament1(env)
    discord.reset()
    await playOutCurrent(env) // Tournament #2
    const [summary] = summaries()
    expect(summary.body.content).toMatch(/Tournament #2 is complete/)
    const text = summary.body.embeds[0].description as string
    const totals = [...text.matchAll(/Total: \*\*(\d+) pts\*\* · #(\d) overall/g)].map((m) => Number(m[1]))
    expect(totals.reduce((a, b) => a + b, 0)).toBe(2 * (10 + 8 + 7 + 6 + 5 + 4 + 3 + 1))
    expect((await getCurrentTournament(env.DB))!.number).toBe(3)
  })

  it('cannot finish (or redraw) the same tournament twice', async () => {
    const env = await started()
    await playTournament1(env)
    const t1 = (await getTournamentByNumber(env.DB, 1))!
    discord.reset()
    await onTournamentComplete(env, { ...t1, status: 'in_progress' })
    expect(summaries()).toHaveLength(0)
    expect(await tournamentCount(env)).toBe(2)
  })

  it('explains when the next tournament cannot start automatically', async () => {
    const env = await started()
    await playTournament1(env, 11)
    await env.DB.prepare("UPDATE players SET active = 0 WHERE discord_user_id = 'u8'").run()
    discord.reset()
    await override(env, 'P1', 'u1')
    expect(summaries()).toHaveLength(1)
    expect(discord.find(CHANNEL_MSGS, 'POST').at(-1)!.body.content).toMatch(
      /can't start automatically: A draw needs exactly 8 active players, but there are 7.*\/draw/s
    )
    expect(await getCurrentTournament(env.DB)).toBeNull()
  })

  it('/draw finishes a tournament whose 12 results were already in, then draws the next', async () => {
    const env = await started()
    await playTournament1(env)
    // Rewind to how it looked before finishing existed: complete but still in progress.
    const t1 = (await getTournamentByNumber(env.DB, 1))!
    const t2 = (await getTournamentByNumber(env.DB, 2))!
    await env.DB.batch([
      env.DB.prepare('DELETE FROM matches WHERE tournament_id = ?').bind(t2.id),
      env.DB.prepare('DELETE FROM tournaments WHERE id = ?').bind(t2.id),
      env.DB.prepare('DELETE FROM placements'),
      env.DB.prepare("UPDATE tournaments SET status = 'in_progress', summary_message_id = NULL WHERE id = ?").bind(t1.id)
    ])
    discord.reset()
    const r = await run(env, admin, 'draw', null)
    expect(r.content).toMatch(/Tournament #1 already has all 12 results/)
    await r.done
    expect(summaries()).toHaveLength(1)
    expect((await getCurrentTournament(env.DB))!.number).toBe(2)
  })
})

describe('corrections to a finished tournament', () => {
  it('a placement-match change posts a Correction and updates totals, without a new draw', async () => {
    const env = await started()
    await playTournament1(env)
    discord.reset()
    const r = await override(env, 'P1', 'u5', { tournament: 1 }) // P5 actually won the final
    expect(r.content).toMatch(/^Done\./)
    const [correction] = summaries()
    expect(correction.body.content).toMatch(/Correction:\*\* the results of Tournament #1 were changed/)
    expect(correction.body.embeds[0].title).toMatch(/📝 Correction · Tournament #1/)
    expect(correction.body.embeds[0].description).toMatch(/1st · P5\*\* <@u5>\n\+10 pts/)
    expect(correction.body.embeds[0].description).toMatch(/2nd · P1\*\* <@u1>\n\+8 pts/)
    expect(await tournamentCount(env)).toBe(2) // no extra draw
    expect((await getCurrentTournament(env.DB))!.number).toBe(2)
  })

  it('a correction that clears matches reopens it; re-entering them posts the Correction', async () => {
    const env = await started()
    await playTournament1(env)
    discord.reset()
    const warning = await run(env, admin, 'result', 'override', { match: 'M1', winner: 'u2', tournament: 1 })
    expect(warning.content).toMatch(/6 later matches will be reset/)
    const apply = await click(env, admin, buttonIds(warning.data)[0], 'eph')
    await apply.done
    expect(apply.content).toMatch(/Tournament #1 is open for corrections/)
    const t1 = (await getTournamentByNumber(env.DB, 1))!
    expect(t1.status).toBe('correcting')
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM placements WHERE tournament_id = ?').bind(t1.id).first('n')).toBe(0)
    expect(discord.find(CHANNEL_MSGS, 'POST')).toHaveLength(0) // no "match ready" posts for a past tournament

    // WA is now P2 v P3, LA is P1 v P4. Re-enter the cleared matches.
    for (const [match, winner] of [['WA', 'u2'], ['LA', 'u1'], ['P3', 'u3'], ['P5', 'u1'], ['P7', 'u4']]) {
      await override(env, match, winner, { tournament: 1 })
    }
    expect(summaries()).toHaveLength(0)
    await override(env, 'P1', 'u2', { tournament: 1 })
    const [correction] = summaries()
    expect(correction.body.content).toMatch(/Correction/)
    expect(correction.body.embeds[0].description).toMatch(/1st · P2\*\*/)
    expect((await getTournamentByNumber(env.DB, 1))!.status).toBe('finished')
    expect(await tournamentCount(env)).toBe(2) // still no extra draw
  })
})

describe('/points set and /rewards set', () => {
  it('editing the points table changes every total', async () => {
    const env = await started()
    const r = await run(env, admin, 'points', 'set', { place: 1, points: 25 })
    expect(r.content).toMatch(/1st place is now worth \*\*25 points\*\*/)
    expect(r.content).toContain('1st: **25** · 2nd: **8**')
    await playTournament1(env)
    const text = summaries()[0].body.embeds[0].description as string
    expect(text).toContain('**1st · P1** <@u1>\n+25 pts')
  })

  it('editing rewards keeps the boxes left empty', async () => {
    const env = await started()
    const r = await run(env, admin, 'rewards', 'set', { place: 5, extra_packs: 5 })
    expect(r.content).toMatch(/5th place now gets: \*\*10 packs \+ 5 extra packs \(15 packs\)\*\*/)
    const both = await run(env, admin, 'rewards', 'set', { place: 3, extra_packs: 2 })
    expect(both.content).toMatch(/3rd place now gets: \*\*10 packs \+ 2 extra packs \(12 packs\) \+ 2 cards of your choice\*\*/)
    expect((await run(env, admin, 'rewards', 'set', { place: 3 })).content).toMatch(/Fill in at least one/)
  })

  it('are admin-only', async () => {
    const env = await started()
    expect((await run(env, member('u1'), 'points', 'set', { place: 1, points: 99 })).content).toMatch(/Only members with/)
    expect((await run(env, member('u1'), 'rewards', 'set', { place: 1, chosen_cards: 9 })).content).toMatch(/Only members with/)
  })
})
