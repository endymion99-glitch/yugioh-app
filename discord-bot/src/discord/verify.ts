// Checks that a request really came from Discord. Discord signs every
// interaction with the application's Ed25519 key; we verify that signature
// with the Web Crypto API built into Workers, so no extra library is needed.

const encoder = new TextEncoder()
let cachedKey: { hex: string; key: Promise<CryptoKey> } | null = null

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

function importPublicKey(hex: string): Promise<CryptoKey> {
  if (cachedKey?.hex === hex) return cachedKey.key
  const bytes = hexToBytes(hex)
  if (!bytes) return Promise.reject(new Error('DISCORD_PUBLIC_KEY is not valid hex'))
  const key = crypto.subtle.importKey('raw', bytes, { name: 'Ed25519' }, false, ['verify'])
  cachedKey = { hex, key }
  return key
}

export async function verifyDiscordSignature(
  publicKeyHex: string,
  signatureHex: string | null,
  timestamp: string | null,
  body: string
): Promise<boolean> {
  if (!signatureHex || !timestamp) return false
  const signature = hexToBytes(signatureHex)
  if (!signature || signature.length !== 64) return false
  try {
    const key = await importPublicKey(publicKeyHex)
    return await crypto.subtle.verify('Ed25519', key, signature, encoder.encode(timestamp + body))
  } catch {
    return false
  }
}
