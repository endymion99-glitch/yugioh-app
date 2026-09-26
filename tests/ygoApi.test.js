import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../src/main/db/index.js'
import { getCachedCard } from '../src/main/db/repositories.js'
import { YgoApi, OfflineError } from '../src/main/ygoApi.js'
import { importCardList, importYdk } from '../src/main/importService.js'

const DB = [
  { id: 89631139, name: 'Blue-Eyes White Dragon', type: 'Normal Monster', alts: [89631140] },
  { id: 46986414, name: 'Dark Magician', type: 'Normal Monster', alts: [] },
  { id: 38033121, name: 'Dark Magician Girl', type: 'Effect Monster', alts: [] },
  { id: 27548199, name: 'Borreload Dragon', type: 'Link Monster', alts: [] },
  { id: 55144522, name: 'Pot of Greed', type: 'Spell Card', alts: [] },
  { id: 29172562, name: 'Steel Ogre Grotto #1', type: 'Normal Monster', alts: [] },
  { id: 90908427, name: 'Steel Ogre Grotto #2', type: 'Normal Monster', alts: [] }
]

const toApi = (c) => ({
  id: c.id,
  name: c.name,
  type: c.type,
  desc: 'text',
  atk: 2500,
  def: 2000,
  card_images: [c.id, ...c.alts].map((id) => ({ id, image_url: `https://img/${id}.jpg` }))
})

// Mimics the YGOprodeck API closely enough for the client's code paths.
function fakeFetch(log) {
  return async (url) => {
    const params = new URL(url).searchParams
    log.push(Object.fromEntries(params))
    let hits = []
    if (params.has('id')) {
      const ids = params.get('id').split(',').map(Number)
      hits = DB.filter((c) => ids.some((id) => id === c.id || c.alts.includes(id)))
      // The real API rejects the request when any id is unknown.
      const known = ids.every((id) => DB.some((c) => c.id === id || c.alts.includes(id)))
      if (!known) hits = []
    } else if (params.has('name')) {
      hits = DB.filter((c) => c.name.toLowerCase() === params.get('name').toLowerCase())
    } else if (params.has('fname')) {
      hits = DB.filter((c) => c.name.toLowerCase().includes(params.get('fname').toLowerCase()))
    }
    if (!hits.length) return new Response(JSON.stringify({ error: 'No card matching' }), { status: 400 })
    return new Response(JSON.stringify({ data: hits.map(toApi) }), { status: 200 })
  }
}

const noLimit = (fn) => fn()

let db, api, log
beforeEach(() => {
  db = openDatabase(':memory:')
  log = []
  api = new YgoApi({ db, fetch: fakeFetch(log), limiter: noLimit })
})

describe('YgoApi', () => {
  it('caches cards and serves repeat lookups from the cache', async () => {
    expect((await api.getById(46986414)).name).toBe('Dark Magician')
    expect(getCachedCard(db, 46986414).name).toBe('Dark Magician')
    await api.getById(46986414)
    expect(log).toHaveLength(1)
  })

  it('resolves batches, alternate artworks and bad ids', async () => {
    const res = await api.getByIds([89631140, 46986414, 1234])
    expect(res.get(89631140).id).toBe(89631139)
    expect(res.get(46986414).name).toBe('Dark Magician')
    expect(res.get(1234)).toBeNull()
  })

  it('matches exact, garbled and truncated names', async () => {
    expect((await api.matchName('dark magician')).card.id).toBe(46986414)
    expect((await api.matchName('Dark Maglcian Girl')).card.id).toBe(38033121)
    expect((await api.matchName('Blue-Eyes White Dr...')).card.id).toBe(89631139)
    expect(await api.matchName('Qwxyz Zzzz')).toBeNull()
  })

  it('uses the hint to choose between cards a truncated name fits equally', async () => {
    const text = 'Steel Ogre Grot...'
    expect((await api.matchName(text, { hint: 'Steel 0gre Grotto #2' })).card.name).toBe('Steel Ogre Grotto #2')
    expect((await api.matchName(text, { hint: 'Steel Ogre Grotto c1' })).card.name).toBe('Steel Ogre Grotto #1')
    // A hint never overrides a clearly better match.
    expect((await api.matchName('Dark Magician', { hint: 'Dark Magician Girl' })).card.name).toBe('Dark Magician')
  })

  it('search merges cache and API results, ranked', async () => {
    const { cards } = await api.search('dark mag')
    expect(cards.map((c) => c.name)).toEqual(['Dark Magician', 'Dark Magician Girl'])
  })

  it('reports offline search instead of failing', async () => {
    await api.getById(46986414)
    const offline = new YgoApi({
      db,
      fetch: async () => {
        throw new TypeError('fetch failed')
      },
      limiter: noLimit
    })
    const r = await offline.search('Dark')
    expect(r.offline).toBe(true)
    expect(r.cards.map((c) => c.name)).toEqual(['Dark Magician'])
    await expect(offline.getById(1)).rejects.toBeInstanceOf(OfflineError)
  })
})

describe('imports', () => {
  it('imports a text list', async () => {
    const r = await importCardList(api, 'Dark Magician\nDark Magician\nPot of Greed\nNot A Real Card')
    expect(r.found.map((f) => [f.card.name, f.quantity])).toEqual([
      ['Dark Magician', 2],
      ['Pot of Greed', 1]
    ])
    expect(r.unrecognized).toEqual([{ text: 'Not A Real Card', quantity: 1 }])
  })

  it('imports a ydk, merging alternate artworks', async () => {
    const r = await importYdk(api, '#main\n89631139\n89631140\n46986414\n#extra\n27548199\n!side\n999\n')
    expect(r.found.map((f) => [f.card.name, f.quantity])).toEqual([
      ['Blue-Eyes White Dragon', 2],
      ['Dark Magician', 1],
      ['Borreload Dragon', 1]
    ])
    expect(r.unrecognized).toEqual([{ text: 'Passcode 999', quantity: 1 }])
  })
})
