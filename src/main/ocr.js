// Tesseract.js OCR. Runs in a Node worker thread spawned from the main
// process, so recognition never blocks the UI. Language data ships with the
// app (@tesseract.js-data/eng), so no download is needed at runtime.

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { createWorker, OEM, PSM } from 'tesseract.js'

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

let workerPromise = null
let progressListener = null

function getWorker() {
  if (!workerPromise) {
    const { workerPath, langPath } = tesseractPaths()
    workerPromise = createWorker('eng', OEM.LSTM_ONLY, {
      workerPath,
      langPath,
      gzip: true,
      cacheMethod: 'none',
      logger: (m) => progressListener?.(m)
    })
      .then(async (worker) => {
        await worker.setParameters({
          // Screenshots are a grid of scattered labels, not a page of prose.
          tessedit_pageseg_mode: PSM.SPARSE_TEXT,
          preserve_interword_spaces: '1'
        })
        return worker
      })
      .catch((err) => {
        workerPromise = null
        throw err
      })
  }
  return workerPromise
}

const toBox = (b) => ({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 })

/**
 * Recognizes text in an image buffer and returns its lines with word boxes.
 * @param {Buffer} image PNG/JPEG bytes
 * @param {(progress:number)=>void} [onProgress] 0..1 recognition progress
 */
export async function recognizeLines(image, onProgress) {
  progressListener = (m) => {
    if (m.status === 'recognizing text') onProgress?.(m.progress)
  }
  try {
    const worker = await getWorker()
    const { data } = await worker.recognize(image, {}, { blocks: true, text: false })
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
  } finally {
    progressListener = null
  }
}

export async function shutdownOcr() {
  if (!workerPromise) return
  const worker = await workerPromise.catch(() => null)
  workerPromise = null
  await worker?.terminate()
}
