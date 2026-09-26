import { contextBridge, ipcRenderer } from 'electron'

// Invokes a main-process handler. Handlers reply with {ok, data} or
// {ok:false, error} so error messages survive the IPC boundary intact.
async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args)
  if (!res?.ok) throw new Error(res?.error || `Request failed: ${channel}`)
  return res.data
}

function subscribe(channel, cb) {
  const listener = (_event, payload) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('api', {
  auth: {
    status: () => call('auth:status'),
    register: (username, password) => call('auth:register', username, password),
    login: (username, password) => call('auth:login', username, password),
    logout: () => call('auth:logout')
  },
  cards: {
    search: (query) => call('cards:search', query),
    get: (cardId) => call('cards:get', cardId)
  },
  collection: {
    list: () => call('collection:list'),
    add: (items) => call('collection:add', items),
    setQuantity: (cardId, quantity) => call('collection:setQuantity', cardId, quantity)
  },
  imports: {
    ocr: (imageBytes) => call('import:ocr', imageBytes),
    txt: (text) => call('import:txt', text),
    ydk: (text) => call('import:ydk', text),
    onProgress: (cb) => subscribe('import:progress', cb)
  },
  decks: {
    list: () => call('decks:list'),
    get: (deckId) => call('decks:get', deckId),
    create: (name) => call('decks:create', name),
    rename: (deckId, name) => call('decks:rename', deckId, name),
    remove: (deckId) => call('decks:delete', deckId),
    save: (deckId, entries) => call('decks:save', deckId, entries),
    exportYdk: (deckId) => call('decks:exportYdk', deckId)
  }
})
