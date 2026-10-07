// Test helpers that act like Discord: they sign requests with a throwaway
// Ed25519 key so the Worker's signature check can be exercised for real.
import type { Env } from '../../src/env'
import { createTestDb } from './d1'

const toHex = (buf: ArrayBuffer) => Buffer.from(buf).toString('hex')

export async function makeSigner() {
  const keys = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const publicKey = toHex((await crypto.subtle.exportKey('raw', keys.publicKey)) as ArrayBuffer)

  async function sign(body: string, timestamp = String(Math.floor(Date.now() / 1000))) {
    const sig = await crypto.subtle.sign('Ed25519', keys.privateKey, new TextEncoder().encode(timestamp + body))
    return { signature: toHex(sig), timestamp }
  }

  async function request(payload: unknown): Promise<Request> {
    const body = JSON.stringify(payload)
    const { signature, timestamp } = await sign(body)
    return new Request('https://bot.example/', {
      method: 'POST',
      headers: { 'x-signature-ed25519': signature, 'x-signature-timestamp': timestamp },
      body
    })
  }

  return { publicKey, sign, request }
}

export function makeEnv(publicKey: string): Env {
  return {
    DB: createTestDb(),
    DISCORD_PUBLIC_KEY: publicKey,
    DISCORD_APPLICATION_ID: 'app-id',
    DISCORD_BOT_TOKEN: 'bot-token',
    REVEAL_DELAY_MS: '0'
  }
}

export function makeCtx(): ExecutionContext & { pending: Promise<unknown>[] } {
  const pending: Promise<unknown>[] = []
  return {
    pending,
    waitUntil: (p: Promise<unknown>) => void pending.push(p),
    passThroughOnException: () => {},
    props: {}
  } as unknown as ExecutionContext & { pending: Promise<unknown>[] }
}
