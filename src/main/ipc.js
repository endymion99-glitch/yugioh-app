import { ipcMain, dialog, BrowserWindow, net } from 'electron'
import { writeFile } from 'node:fs/promises'
import bcrypt from 'bcryptjs'
import * as repo from './db/repositories.js'
import { YgoApi } from './ygoApi.js'
import * as ocr from './ocr.js'
import { importCardList, importYdk, importScreenshot } from './importService.js'
import { validateDeck, SECTIONS } from '@shared/deckRules.js'
import { buildYdk } from '@shared/ydk.js'

const MAX_IMAGE_BYTES = 80 * 1024 * 1024
const MAX_TEXT_BYTES = 2 * 1024 * 1024

class UserError extends Error {}

/** Registers every ipcMain handler. Replies are {ok, data} | {ok:false, error}. */
export function registerIpc(db) {
  const api = new YgoApi({ db, fetch: (url) => net.fetch(url) })
  let currentUser = null

  const handle = (channel, fn, { auth = true } = {}) => {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        if (auth && !currentUser) throw new UserError('Please log in first.')
        return { ok: true, data: await fn(event, ...args) }
      } catch (err) {
        if (!(err instanceof UserError)) console.error(`[ipc ${channel}]`, err)
        return { ok: false, error: err.message || String(err) }
      }
    })
  }

  const progressSender = (event) => (payload) => {
    if (!event.sender.isDestroyed()) event.sender.send('import:progress', payload)
  }

  const toInt = (v, what) => {
    const n = Number(v)
    if (!Number.isInteger(n)) throw new UserError(`Invalid ${what}.`)
    return n
  }

  const text = (v, what, max = 80) => {
    const s = String(v ?? '').trim()
    if (!s) throw new UserError(`${what} cannot be empty.`)
    if (s.length > max) throw new UserError(`${what} is too long (max ${max} characters).`)
    return s
  }

  // ---------------------------------------------------------------- auth --

  handle('auth:status', () => ({ hasUser: repo.countUsers(db) > 0, user: currentUser }), {
    auth: false
  })

  handle(
    'auth:register',
    async (_e, username, password) => {
      if (repo.countUsers(db) > 0) {
        throw new UserError('A profile already exists on this computer. Please log in.')
      }
      const name = text(username, 'Username', 32)
      if (String(password || '').length < 4) {
        throw new UserError('Password must be at least 4 characters.')
      }
      const hash = await bcrypt.hash(String(password), 10)
      currentUser = repo.createUser(db, name, hash)
      return currentUser
    },
    { auth: false }
  )

  handle(
    'auth:login',
    async (_e, username, password) => {
      const user = repo.getUserByUsername(db, String(username || '').trim())
      const ok = user && (await bcrypt.compare(String(password || ''), user.passwordHash))
      if (!ok) throw new UserError('Wrong username or password.')
      currentUser = { id: user.id, username: user.username }
      return currentUser
    },
    { auth: false }
  )

  handle('auth:logout', () => {
    currentUser = null
    return true
  })

  // --------------------------------------------------------------- cards --

  handle('cards:search', (_e, query) => api.search(String(query || '')))
  handle('cards:get', (_e, cardId) => api.getById(toInt(cardId, 'card id')))

  // ---------------------------------------------------------- collection --

  handle('collection:list', () => repo.listCollection(db, currentUser.id))

  handle('collection:add', async (_e, items) => {
    if (!Array.isArray(items)) throw new UserError('Nothing to add.')
    const rows = items.map((i) => ({
      cardId: toInt(i.cardId, 'card id'),
      quantity: toInt(i.quantity, 'quantity')
    }))
    // Cards normally arrive already cached by the lookup; fetch any that aren't.
    for (const r of rows) {
      if (!repo.getCachedCard(db, r.cardId) && !(await api.getById(r.cardId))) {
        throw new UserError(`Unknown card #${r.cardId}.`)
      }
    }
    const added = repo.addToCollection(db, currentUser.id, rows)
    return { added }
  })

  handle('collection:setQuantity', (_e, cardId, quantity) => {
    const id = toInt(cardId, 'card id')
    const n = Math.max(0, toInt(quantity, 'quantity'))
    return repo.setCollectionQuantity(db, currentUser.id, id, n)
  })

  // ------------------------------------------------------------- imports --

  handle('import:txt', (event, content) => {
    const s = String(content ?? '')
    if (s.length > MAX_TEXT_BYTES) throw new UserError('That file is too large.')
    return importCardList(api, s, progressSender(event))
  })

  handle('import:ydk', (event, content) => {
    const s = String(content ?? '')
    if (s.length > MAX_TEXT_BYTES) throw new UserError('That file is too large.')
    return importYdk(api, s, progressSender(event))
  })

  handle('import:ocr', async (event, payload) => {
    const images = payload?.cards
      ? payload.cards.flatMap((c) => [c.name, c.nameAlt, ...(c.qtyGlyphs || [])])
      : [payload?.full]
    if (!images.length || !images.every((b) => b instanceof Uint8Array && b.byteLength > 0)) {
      throw new UserError('No image received.')
    }
    const total = images.reduce((s, b) => s + b.byteLength, 0)
    if (total > MAX_IMAGE_BYTES) throw new UserError('That image is too large.')
    try {
      return await importScreenshot(api, ocr, payload, progressSender(event))
    } finally {
      // Imports are occasional; don't keep the OCR model in memory.
      ocr.shutdownOcr().catch(() => {})
    }
  })

  // --------------------------------------------------------------- decks --

  const ownDeck = (deckId) => {
    const deck = repo.getDeck(db, currentUser.id, toInt(deckId, 'deck id'))
    if (!deck) throw new UserError('Deck not found.')
    return deck
  }

  const normalizeEntries = (entries) => {
    if (!Array.isArray(entries)) throw new UserError('Invalid deck contents.')
    return entries.map((e) => {
      const cardId = toInt(e.cardId, 'card id')
      const quantity = toInt(e.quantity, 'quantity')
      if (!SECTIONS.includes(e.section)) throw new UserError('Invalid deck section.')
      if (quantity <= 0) throw new UserError('Invalid quantity.')
      const card = repo.getCachedCard(db, cardId)
      if (!card) throw new UserError(`Unknown card #${cardId}.`)
      return { cardId, section: e.section, quantity, name: card.name, type: card.type }
    })
  }

  handle('decks:list', () => repo.listDecks(db, currentUser.id))
  handle('decks:get', (_e, deckId) => ownDeck(deckId))
  handle('decks:create', (_e, name) => repo.createDeck(db, currentUser.id, text(name, 'Deck name')))

  handle('decks:rename', (_e, deckId, name) => {
    ownDeck(deckId)
    repo.renameDeck(db, currentUser.id, Number(deckId), text(name, 'Deck name'))
    return ownDeck(deckId)
  })

  handle('decks:delete', (_e, deckId) => {
    ownDeck(deckId)
    return repo.deleteDeck(db, currentUser.id, Number(deckId))
  })

  handle('decks:save', (_e, deckId, entries) => {
    const deck = ownDeck(deckId)
    const rows = normalizeEntries(entries)
    const { errors } = validateDeck(rows, repo.ownedQuantities(db, currentUser.id))
    if (errors.length) {
      throw new UserError(`Deck can't be saved yet:\n• ${errors.map((e) => e.message).join('\n• ')}`)
    }
    return repo.saveDeckCards(db, currentUser.id, deck.id, rows)
  })

  handle('decks:exportYdk', async (event, deckId, entries) => {
    const deck = ownDeck(deckId)
    const rows = entries ? normalizeEntries(entries) : deck.cards.map((c) => ({ ...c, cardId: c.id }))
    const win = BrowserWindow.fromWebContents(event.sender)
    const safeName = deck.name.replace(/[\\/:*?"<>|]+/g, '_')
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Export deck as .ydk',
      defaultPath: `${safeName}.ydk`,
      filters: [{ name: 'YGOPro deck', extensions: ['ydk'] }]
    })
    if (canceled || !filePath) return null
    await writeFile(filePath, buildYdk(rows), 'utf8')
    return { filePath }
  })
}
