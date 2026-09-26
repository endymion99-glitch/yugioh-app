// Serves card images through a custom `ygo-img://` protocol, caching them in
// the app data folder so the collection and decks still show art offline.
//
//   ygo-img://card/89631139   -> full-size image
//   ygo-img://small/89631139  -> thumbnail

import { protocol, net } from 'electron'
import { mkdir, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CARD_IMAGE_CDN, CARD_IMAGE_SMALL_CDN } from '@shared/cardTypes.js'

export const IMAGE_SCHEME = 'ygo-img'

const SOURCES = { card: CARD_IMAGE_CDN, small: CARD_IMAGE_SMALL_CDN }

export function registerImageProtocolScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: IMAGE_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

const inflight = new Map()

async function exists(p) {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

async function ensureCached(cacheDir, size, id) {
  const dir = join(cacheDir, size)
  const file = join(dir, `${id}.jpg`)
  if (await exists(file)) return file

  const key = `${size}/${id}`
  if (!inflight.has(key)) {
    const job = (async () => {
      const res = await net.fetch(`${SOURCES[size]}/${id}.jpg`)
      if (!res.ok) throw new Error(`Image download failed: HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      await mkdir(dir, { recursive: true })
      await writeFile(file, buf)
      return file
    })().finally(() => inflight.delete(key))
    inflight.set(key, job)
  }
  return inflight.get(key)
}

export function registerImageProtocol(cacheDir) {
  protocol.handle(IMAGE_SCHEME, async (request) => {
    const url = new URL(request.url)
    const size = url.hostname
    const id = url.pathname.replace(/^\/+/, '').replace(/\.jpg$/, '')
    if (!SOURCES[size] || !/^\d+$/.test(id)) {
      return new Response('Bad image request', { status: 400 })
    }
    try {
      const file = await ensureCached(cacheDir, size, id)
      return net.fetch(pathToFileURL(file).toString())
    } catch (err) {
      return new Response(String(err.message || err), { status: 502 })
    }
  })
}
