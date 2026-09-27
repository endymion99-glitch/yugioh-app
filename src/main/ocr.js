// Tesseract.js OCR. Recognition runs in Node worker threads spawned from the
// main process, so it never blocks the UI. Language data ships with the app
// (@tesseract.js-data/eng), so nothing is downloaded at runtime.

import { createRequire } from 'node:module'
import { cpus } from 'node:os'
import { dirname, join } from 'node:path'
import { createScheduler, createWorker, OEM, PSM } from 'tesseract.js'

const require = createRequire(import.meta.url)

// Files unpacked from app.asar (see electron-builder.yml asarUnpack) must be
// addressed through app.asar.unpacked, because worker threads cannot load
// scripts from inside the archive.
const unpacked = (p) => p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')

function tesseractPaths() {
  const pkgDir = dirname(require.resolve('tesseract.js/package.json'))
  const langDir = join(dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int')
  return {
    workerPath: unpacked(join(pkgDir, 'src', 'worker-script', 'node', 'index.js')),
    langPath: unpacked(langDir)
  }
}

// Worker pools by purpose; each purpose needs different Tesseract settings.
const POOLS = {
  // One cropped card-name strip.
  name: {
    size: () => Math.max(1, Math.min(3, cpus().length - 1)),
    params: { tessedit_pageseg_mode: PSM.SINGLE_LINE }
  },
  // A tight image of the copy-count overlay glyphs.
  qty: {
    size: () => 1,
    params: { tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: '0123456789xX' }
  },
  // Whole screenshot (fallback when no card grid is found).
  page: {
    size: () => 1,
    params: { tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: '1' }
  }
}

const schedulers = new Map()

const START_TIMEOUT_MS = 60_000
const JOB_TIMEOUT_MS = 60_000

// A worker thread that fails to load never settles tesseract.js's promises,
// so bound every wait and surface a real error instead of hanging.
function withTimeout(promise, ms, message) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms)
    })
  ]).finally(() => clearTimeout(timer))
}

function getScheduler(kind) {
  if (!schedulers.has(kind)) {
    const { workerPath, langPath } = tesseractPaths()
    const pool = POOLS[kind]
    const promise = (async () => {
      const scheduler = createScheduler()
      const workers = await withTimeout(
        Promise.all(
          Array.from({ length: pool.size() }, async () => {
            const w = await createWorker('eng', OEM.LSTM_ONLY, {
              workerPath,
              langPath,
              gzip: true,
              cacheMethod: 'none',
              errorHandler: (err) => console.error('[ocr worker]', err)
            })
            await w.setParameters(pool.params)
            return w
          })
        ),
        START_TIMEOUT_MS,
        'The OCR engine failed to start.'
      )
      workers.forEach((w) => scheduler.addWorker(w))
      return scheduler
    })()
    promise.catch(() => schedulers.delete(kind))
    schedulers.set(kind, promise)
  }
  return schedulers.get(kind)
}

const toBox = (b) => ({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 })

function flattenLines(data) {
  const lines = []
  for (const block of data.blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        lines.push({
          text: line.text,
          confidence: line.confidence,
          bbox: toBox(line.bbox),
          words: (line.words || []).map((w) => ({
            text: w.text,
            confidence: w.confidence,
            bbox: toBox(w.bbox)
          }))
        })
      }
    }
  }
  return lines
}

async function recognize(kind, image) {
  const scheduler = await getScheduler(kind)
  const { data } = await withTimeout(
    scheduler.addJob('recognize', Buffer.from(image), {}, { blocks: true, text: true }),
    JOB_TIMEOUT_MS,
    'Reading the screenshot timed out.'
  )
  return { text: (data.text || '').trim(), confidence: data.confidence, lines: flattenLines(data) }
}

/** OCR of a cropped card-name strip. */
export const recognizeName = (image) => recognize('name', image)

/** OCR of an isolated copy-count glyph image, digits and "x" only. */
export const recognizeQuantity = (image) => recognize('qty', image)

/** OCR of a whole screenshot; returns its lines with word boxes. */
export async function recognizeLines(image) {
  return (await recognize('page', image)).lines
}

/** Frees the OCR workers (they hold the language model in memory). */
export async function shutdownOcr() {
  const all = [...schedulers.values()]
  schedulers.clear()
  await Promise.all(
    all.map(async (p) => {
      const s = await p.catch(() => null)
      await s?.terminate()
    })
  )
}
