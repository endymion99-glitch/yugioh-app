// Loads the bundled artwork index (built by scripts/build-art-index.mjs).
// Without it, screenshot imports simply fall back to reading names.

import { app } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ArtIndex, decodeArtIndex } from '@shared/artHash.js'

let loading = null

export function artIndexPath() {
  return app.isPackaged
    ? join(process.resourcesPath, 'art-index.bin')
    : join(app.getAppPath(), 'resources', 'art-index.bin')
}

/** Resolves to an ArtIndex, or null when no index is available. */
export function loadArtIndex() {
  if (!loading) {
    loading = readFile(artIndexPath())
      .then((buf) => new ArtIndex(decodeArtIndex(new Uint8Array(buf))))
      .catch((err) => {
        console.warn(`[art index] not available: ${err.message}`)
        return null
      })
  }
  return loading
}
