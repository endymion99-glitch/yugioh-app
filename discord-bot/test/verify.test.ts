import { describe, expect, it } from 'vitest'
import { verifyDiscordSignature } from '../src/discord/verify'
import { makeSigner } from './helpers/discord'

describe('verifyDiscordSignature', () => {
  it('accepts a correctly signed body', async () => {
    const s = await makeSigner()
    const { signature, timestamp } = await s.sign('{"type":1}')
    expect(await verifyDiscordSignature(s.publicKey, signature, timestamp, '{"type":1}')).toBe(true)
  })

  it('rejects a tampered body or timestamp', async () => {
    const s = await makeSigner()
    const { signature, timestamp } = await s.sign('{"type":1}')
    expect(await verifyDiscordSignature(s.publicKey, signature, timestamp, '{"type":2}')).toBe(false)
    expect(await verifyDiscordSignature(s.publicKey, signature, timestamp + '1', '{"type":1}')).toBe(false)
  })

  it('rejects a signature made with a different key', async () => {
    const a = await makeSigner()
    const b = await makeSigner()
    const { signature, timestamp } = await b.sign('hello')
    expect(await verifyDiscordSignature(a.publicKey, signature, timestamp, 'hello')).toBe(false)
  })

  it('rejects missing or malformed headers instead of throwing', async () => {
    const s = await makeSigner()
    expect(await verifyDiscordSignature(s.publicKey, null, '1', 'x')).toBe(false)
    expect(await verifyDiscordSignature(s.publicKey, 'ab', null, 'x')).toBe(false)
    expect(await verifyDiscordSignature(s.publicKey, 'not-hex', '1', 'x')).toBe(false)
    expect(await verifyDiscordSignature(s.publicKey, 'ab'.repeat(10), '1', 'x')).toBe(false)
    expect(await verifyDiscordSignature('zz', 'ab'.repeat(64), '1', 'x')).toBe(false)
  })
})
