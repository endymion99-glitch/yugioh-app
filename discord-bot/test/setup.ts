import { beforeEach, vi } from 'vitest'
import { discord } from './helpers/fakeDiscord'

beforeEach(() => {
  discord.reset()
  vi.stubGlobal('fetch', discord.fetch)
})
