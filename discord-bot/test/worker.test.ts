import { describe, expect, it } from 'vitest'
import worker from '../src/index'
import { InteractionType, MessageFlags, ResponseType } from '../src/discord/types'
import { makeCtx, makeEnv, makeSigner } from './helpers/discord'

const commandPayload = (name: string) => ({
  id: '1',
  application_id: 'app-id',
  type: InteractionType.APPLICATION_COMMAND,
  token: 'tok',
  guild_id: 'guild',
  channel_id: 'chan',
  member: { user: { id: 'u1', username: 'yugi' }, roles: [], permissions: '0' },
  data: { name }
})

describe('worker', () => {
  it('answers GET with a health message', async () => {
    const s = await makeSigner()
    const res = await worker.fetch(new Request('https://bot.example/'), makeEnv(s.publicKey), makeCtx())
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('running')
  })

  it('rejects unsigned and badly signed requests with 401 (Discord tests this)', async () => {
    const s = await makeSigner()
    const env = makeEnv(s.publicKey)
    const unsigned = new Request('https://bot.example/', { method: 'POST', body: '{"type":1}' })
    expect((await worker.fetch(unsigned, env, makeCtx())).status).toBe(401)

    const signed = await s.request({ type: 1 })
    const tampered = new Request(signed.url, { method: 'POST', headers: signed.headers, body: '{"type":2}' })
    expect((await worker.fetch(tampered, env, makeCtx())).status).toBe(401)
  })

  it('answers Discord verification PING with PONG', async () => {
    const s = await makeSigner()
    const res = await worker.fetch(await s.request({ type: InteractionType.PING }), makeEnv(s.publicKey), makeCtx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ type: ResponseType.PONG })
  })

  it('replies to /ping privately with no mentions', async () => {
    const s = await makeSigner()
    const res = await worker.fetch(await s.request(commandPayload('ping')), makeEnv(s.publicKey), makeCtx())
    const body = (await res.json()) as any
    expect(body.type).toBe(ResponseType.CHANNEL_MESSAGE)
    expect(body.data.content).toContain('Pong')
    expect(body.data.flags & MessageFlags.EPHEMERAL).toBeTruthy()
    expect(body.data.allowed_mentions).toEqual({ parse: [] })
  })

  it('gives a friendly message for unknown commands', async () => {
    const s = await makeSigner()
    const res = await worker.fetch(await s.request(commandPayload('nope')), makeEnv(s.publicKey), makeCtx())
    const body = (await res.json()) as any
    expect(body.data.content).toMatch(/don't know that command/)
  })
})
