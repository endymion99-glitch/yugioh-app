import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { openDatabase } from './db/index.js'
import { registerImageProtocolScheme, registerImageProtocol } from './imageCache.js'
import { registerIpc } from './ipc.js'
import { shutdownOcr } from './ocr.js'

// Must happen before the app is ready.
registerImageProtocolScheme()

let db

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#0b0b16',
    autoHideMenuBar: true,
    title: 'YGO Collection Manager',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.once('ready-to-show', () => win.show())

  // Open external links (e.g. ygoprodeck.com) in the user's browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

app.whenReady().then(() => {
  const userData = app.getPath('userData')
  db = openDatabase(join(userData, 'ygo-collection.sqlite'))

  registerImageProtocol(join(userData, 'image-cache'))
  registerIpc(db)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  shutdownOcr().catch(() => {})
  db?.close()
})
