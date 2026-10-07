import { describe, expect, it } from 'vitest'
import { listPlayers } from '../src/db/players'
import { getCurrentTournament, loadMatches } from '../src/db/tournaments'
import { ResponseType, MessageFlags } from '../src/discord/types'
import type { Env } from '../src/env'
import { discord } from './helpers/fakeDiscord'
import {
  TOURNAMENT_CHANNEL,
  addEightPlayers,
  admin,
  makeTestEnv,
  member,
  run,
  setupServer
} from './helpers/interactions'

async function readyServer() {
  const env = makeTestEnv()
  await setupServer(env)
  await addEightPlayers(env)
  return env
}

const manualSeats = {
  m1_p1: 'u1', m1_p2: 'u2', m2_p1: 'u3', m2_p2: 'u4',
  m3_p1: 'u5', m3_p2: 'u6', m4_p1: 'u7', m4_p2: 'u8'
}

async function tournamentCount(env: Env) {
  return env.DB.prepare('SELECT COUNT(*) AS n FROM tournaments').first<number>('n')
}

describe('/draw', () => {
  it('in the tournament channel: defers, reveals step by step, then tags all 8 players', async () => {
    const env = await readyServer()
    const r = await run(env, admin, 'draw', null, {}, { channel: TOURNAMENT_CHANNEL })
    expect(r.type).toBe(ResponseType.DEFERRED_CHANNEL_MESSAGE)
    expect(r.ephemeral).toBe(false)
    await r.done

    // Intro + 4 reveal frames, all edits of the deferred reply.
    const edits = discord.find('/messages/@original', 'PATCH')
    expect(edits).toHaveLength(5)
    expect(edits[0].body.embeds[0].description).toMatch(/Shuffling/)
    expect(edits[0].body.embeds[0].description.match(/❔ vs ❔/g)).toHaveLength(4)
    expect(edits[2].body.embeds[0].description.match(/❔ vs ❔/g)).toHaveLength(2)
    expect(edits[4].body.embeds[0].description).not.toMatch(/❔/)
    expect(edits[0].body.allowed_mentions).toEqual({ parse: [] })

    // The final message is new (so it pings) and only pings the 8 players.
    const final = discord.calls.at(-1)!
    expect(final.method).toBe('POST')
    expect(final.path).toBe('/webhooks/app-id/tok')
    expect(final.body.content).toMatch(/Tournament #1 begins/)
    expect(final.body.allowed_mentions.users.sort()).toEqual(['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8'])
    for (let i = 1; i <= 8; i++) expect(final.body.content).toContain(`<@u${i}>`)

    // Saved: tournament #1 with 12 matches; Round 1 uses all 8 players once.
    const t = (await getCurrentTournament(env.DB))!
    expect(t.number).toBe(1)
    const matches = await loadMatches(env.DB, t.id)
    expect(matches).toHaveLength(12)
    const r1 = matches.filter((m) => m.stage === 'R1')
    expect(r1.every((m) => m.status === 'ready' && m.announcedAt)).toBe(true)
    const ids = (await listPlayers(env.DB, { activeOnly: true })).map((p) => p.id).sort()
    expect(r1.flatMap((m) => [m.player1, m.player2]).sort()).toEqual(ids)
    expect(matches.find((m) => m.slot === 'P1')!.bestOf).toBe(3)
  })

  it('from another channel: reveals in the tournament channel and tells the admin privately', async () => {
    const env = await readyServer()
    const r = await run(env, admin, 'draw', null, {}, { channel: 'somewhere-else' })
    expect(r.type).toBe(ResponseType.DEFERRED_CHANNEL_MESSAGE)
    expect(r.data.flags & MessageFlags.EPHEMERAL).toBeTruthy()
    await r.done

    const channelPath = `/channels/${TOURNAMENT_CHANNEL}/messages`
    expect(discord.find(channelPath, 'POST')).toHaveLength(2) // reveal message + final tag message
    expect(discord.find(`${channelPath}/msg-1`, 'PATCH')).toHaveLength(4) // the 4 reveal steps edit it
    const confirmation = discord.find('/messages/@original', 'PATCH').at(-1)!
    expect(confirmation.body.content).toBe(`Tournament #1 has been drawn in <#${TOURNAMENT_CHANNEL}>.`)
  })

  it('undoes the draw if it cannot post in the tournament channel', async () => {
    const env = await readyServer()
    discord.fail((c) => c.path.startsWith('/channels/'))
    const r = await run(env, admin, 'draw', null, {}, { channel: 'somewhere-else' })
    await r.done
    const msg = discord.find('/messages/@original', 'PATCH').at(-1)!.body.content
    expect(msg).toMatch(/don't have permission to post there/)
    expect(msg).toMatch(/No tournament was created/)
    expect(await tournamentCount(env)).toBe(0)
  })

  it('refuses while a tournament is in progress', async () => {
    const env = await readyServer()
    await (await run(env, admin, 'draw', null)).done
    const r = await run(env, admin, 'draw', null)
    expect(r.content).toBe('Tournament #1 is still in progress.')
    expect(r.ephemeral).toBe(true)
  })

  it('refuses without exactly 8 active players, a channel, or the admin role', async () => {
    const env = makeTestEnv()
    await setupServer(env)
    await run(env, admin, 'player', 'add', { user: 'u1', name: 'P1' })
    expect((await run(env, admin, 'draw', null)).content).toMatch(/exactly 8 active players, but there are 1/)
    expect((await run(env, member('u1'), 'draw', null)).content).toMatch(/Only members with/)

    const noChannel = makeTestEnv()
    await run(noChannel, { id: 'o', permissions: '8' }, 'config', 'admin-role', { role: 'role-admin' })
    expect((await run(noChannel, admin, 'draw', null)).content).toMatch(/Set the tournament channel first/)
  })

  it('numbers tournaments after the last one', async () => {
    const env = await readyServer()
    await env.DB.prepare("INSERT INTO tournaments (number, status) VALUES (1, 'finished')").run()
    await (await run(env, admin, 'draw', null)).done
    expect((await getCurrentTournament(env.DB))!.number).toBe(2)
  })
})

describe('/tournament create-manual', () => {
  it('creates tournament #1 from the given pairings and posts them, tagging everyone', async () => {
    const env = await readyServer()
    const r = await run(env, admin, 'tournament', 'create-manual', manualSeats)
    expect(r.ephemeral).toBe(true)
    expect(r.content).toMatch(/Created \*\*Tournament #1\*\* from your pairings/)
    expect(r.content).toMatch(/\/result override/)

    const t = (await getCurrentTournament(env.DB))!
    const matches = await loadMatches(env.DB, t.id)
    const players = new Map((await listPlayers(env.DB)).map((p) => [p.id, p.discord_user_id]))
    const r1 = matches.filter((m) => m.stage === 'R1').map((m) => [players.get(m.player1!), players.get(m.player2!)])
    expect(r1).toEqual([['u1', 'u2'], ['u3', 'u4'], ['u5', 'u6'], ['u7', 'u8']])

    const post = discord.find(`/channels/${TOURNAMENT_CHANNEL}/messages`, 'POST')[0]
    expect(post.body.content).toContain('**Match 1:** <@u1> vs <@u2>')
    expect(post.body.allowed_mentions.users).toHaveLength(8)
  })

  it('refuses duplicates and people who are not active players', async () => {
    const env = await readyServer()
    expect((await run(env, admin, 'tournament', 'create-manual', { ...manualSeats, m4_p2: 'u1' })).content).toMatch(
      /<@u1> is listed more than once/
    )
    expect((await run(env, admin, 'tournament', 'create-manual', { ...manualSeats, m4_p2: 'u9' })).content).toMatch(
      /<@u9> is not an active player/
    )
    expect(await tournamentCount(env)).toBe(0)
  })

  it('still creates the tournament if posting fails, and says why', async () => {
    const env = await readyServer()
    discord.fail(() => true)
    const r = await run(env, admin, 'tournament', 'create-manual', manualSeats)
    expect(r.content).toMatch(/Created \*\*Tournament #1\*\*/)
    expect(r.content).toMatch(/couldn't post the pairings/)
  })

  it('refuses while a tournament is in progress', async () => {
    const env = await readyServer()
    await run(env, admin, 'tournament', 'create-manual', manualSeats)
    expect((await run(env, admin, 'tournament', 'create-manual', manualSeats)).content).toMatch(/still in progress/)
  })
})

describe('match announcements', () => {
  it('a swapped-in player is tagged for the match they take over', async () => {
    const env = await readyServer()
    await run(env, admin, 'tournament', 'create-manual', manualSeats)
    discord.reset()
    const r = await run(env, admin, 'player', 'swap', { old: 'u2', new: 'u9', name: 'Mai' })
    await r.done
    const post = discord.find(`/channels/${TOURNAMENT_CHANNEL}/messages`, 'POST')[0]
    expect(post.body.content).toMatch(/A new match is ready/)
    expect(post.body.content).toMatch(/Tournament #1 · Round 1 · Match 1\*\* \(Best of 1\)/)
    expect(post.body.content).toContain('<@u1> vs <@u9>')
    expect(post.body.allowed_mentions).toEqual({ users: ['u1', 'u9'] })
  })
})
