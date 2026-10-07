import { describe, expect, it, vi } from 'vitest'
import worker from '../src/index'
import { InteractionType } from '../src/discord/types'
import { discord } from './helpers/fakeDiscord'
import { makeCtx, makeEnv, makeSigner } from './helpers/discord'
import {
  MANUAL_SEATS,
  TOURNAMENT_CHANNEL,
  addEightPlayers,
  admin,
  makeTestEnv,
  member,
  run,
  setupServer
} from './helpers/interactions'

describe('swapping a player with a report waiting', () => {
  it('marks the report message as cancelled and announces the match for the replacement', async () => {
    const env = makeTestEnv()
    await setupServer(env)
    await addEightPlayers(env)
    await run(env, admin, 'tournament', 'create-manual', MANUAL_SEATS)
    await (await run(env, member('u1'), 'report', null, { result: 'won' })).done
    const claimId = 'msg-2' // msg-1 is the pairings post
    discord.reset()

    const r = await run(env, admin, 'player', 'swap', { old: 'u2', new: 'u9', name: 'Mai' })
    await r.done
    const edit = discord.find(`/channels/${TOURNAMENT_CHANNEL}/messages/${claimId}`, 'PATCH')[0]
    expect(edit.body.content).toMatch(/Cancelled: a player in this match was replaced/)
    expect(edit.body.components).toEqual([])
    const announce = discord.find(`/channels/${TOURNAMENT_CHANNEL}/messages`, 'POST')[0]
    expect(announce.body.content).toContain('<@u1> vs <@u9>')
  })
})

describe('unexpected errors', () => {
  it('reply with a friendly message instead of failing silently', async () => {
    const signer = await makeSigner()
    const env = makeEnv(signer.publicKey)
    // A database that is broken (e.g. migrations not applied).
    env.DB = { prepare: () => { throw new Error('no such table: config') } } as unknown as D1Database
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const req = await signer.request({
      id: '1',
      application_id: 'app-id',
      type: InteractionType.APPLICATION_COMMAND,
      token: 'tok',
      guild_id: 'g',
      channel_id: 'c',
      member: { user: { id: 'u1', username: 'u1' }, roles: [], permissions: '0' },
      data: { name: 'standings' }
    })
    const res = await worker.fetch(req, env, makeCtx())
    const body = (await res.json()) as any
    expect(body.data.content).toMatch(/Something went wrong on my side/)
    expect(body.data.flags).toBe(64)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('unknown buttons and malformed JSON are handled', async () => {
    const signer = await makeSigner()
    const env = makeEnv(signer.publicKey)
    const button = await worker.fetch(
      await signer.request({ id: '1', application_id: 'a', type: InteractionType.MESSAGE_COMPONENT, token: 't', data: { custom_id: 'old:thing' } }),
      env,
      makeCtx()
    )
    expect(((await button.json()) as any).data.content).toMatch(/no longer active/)

    const { signature, timestamp } = await signer.sign('{not json')
    const bad = new Request('https://bot.example/', {
      method: 'POST',
      headers: { 'x-signature-ed25519': signature, 'x-signature-timestamp': timestamp },
      body: '{not json'
    })
    expect((await worker.fetch(bad, env, makeCtx())).status).toBe(400)
  })
})

describe('reveal timing', () => {
  it('stays inside the time Cloudflare allows after replying (~30 s)', async () => {
    const { revealDelay, playReveal } = await import('../src/services/draw')
    const env = makeEnv('00')
    delete env.REVEAL_DELAY_MS
    expect(revealDelay(env)).toBe(2500)

    vi.useFakeTimers()
    const shown: number[] = []
    const target = {
      started: false,
      async show() {
        shown.push(Date.now())
        this.started = true
      },
      async finish() {
        shown.push(Date.now())
      }
    }
    const players = new Map(Array.from({ length: 8 }, (_, i) => [i + 1, { name: `P${i + 1}`, discord_user_id: `u${i + 1}` }]))
    const drawn = { tournament: { number: 1 } as any, pairs: [[1, 2], [3, 4], [5, 6], [7, 8]] as any, players, matchIds: [] }
    env.DB = { batch: async () => [], prepare: () => ({ bind: () => ({}) }) } as any
    const start = Date.now()
    const done = playReveal(env, target, drawn)
    await vi.runAllTimersAsync()
    await done
    vi.useRealTimers()
    expect(shown).toHaveLength(6) // intro + 4 reveals + final tag message
    const total = shown.at(-1)! - start
    expect(total).toBe(12_500)
    expect(total).toBeLessThan(20_000)
  })
})
