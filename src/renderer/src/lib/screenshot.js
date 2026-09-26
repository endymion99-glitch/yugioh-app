// Prepares a pack-opening screenshot for OCR.
//
// When the cards can be located (a grid on a plain background), each card's
// name strip and bottom-right corner are cropped, upscaled and normalized to
// dark-text-on-white, which Tesseract reads far more reliably than a whole
// busy screenshot. Otherwise the full image is sent, upscaled and greyscaled.

import {
  detectCardGrid,
  dominantBorderColor,
  findCaption,
  subRect,
  NAME_REGION,
  QTY_REGION
} from '@shared/cardGrid.js'
import { findGlyphGroups } from '@shared/glyphs.js'

const NAME_HEIGHT = 72 // px the name strip is scaled to
const QTY_HEIGHT = 140 // px the corner crop is scaled to before glyph search
const GLYPH_HEIGHT = 64 // px a glyph image is scaled to for OCR
const MAX_GLYPH_GROUPS = 3
const PAD = 12
const FULL_TARGET_WIDTH = 2600
const FULL_MAX_PIXELS = 30_000_000

async function toPng(canvas) {
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}

/**
 * Crops `rect` from the source, scales it to `targetH`, converts to grey and
 * returns two PNGs: `primary` with the text made dark on light (polarity
 * guessed from which extreme is the minority) and `alt`, its inverse.
 */
async function cropVariants(source, rect, targetH) {
  const scale = targetH / rect.h
  const w = Math.max(1, Math.round(rect.w * scale))
  const h = targetH
  const canvas = new OffscreenCanvas(w + PAD * 2, h + PAD * 2)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h, PAD, PAD, w, h)

  const img = ctx.getImageData(PAD, PAD, w, h)
  const px = img.data
  const lum = new Uint8ClampedArray(w * h)
  const hist = new Uint32Array(256)
  for (let i = 0, o = 0; i < lum.length; i++, o += 4) {
    lum[i] = 0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2]
    hist[lum[i]]++
  }
  // Median and 2nd/98th percentiles for polarity and contrast stretch.
  const pct = (p) => {
    let acc = 0
    const target = lum.length * p
    for (let v = 0; v < 256; v++) if ((acc += hist[v]) >= target) return v
    return 255
  }
  const med = pct(0.5)
  const lo = pct(0.02)
  const hi = Math.max(lo + 1, pct(0.98))
  let bright = 0
  let dark = 0
  for (const v of lum) {
    if (v > med + 40) bright++
    else if (v < med - 40) dark++
  }
  const textIsBright = bright > dark

  const render = (invert) => {
    const out = new OffscreenCanvas(w + PAD * 2, h + PAD * 2)
    const octx = out.getContext('2d')
    const data = octx.createImageData(w + PAD * 2, h + PAD * 2)
    const d = data.data
    d.fill(255)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = ((lum[y * w + x] - lo) * 255) / (hi - lo)
        v = Math.max(0, Math.min(255, v))
        if (invert) v = 255 - v
        const o = ((y + PAD) * (w + PAD * 2) + x + PAD) * 4
        d[o] = d[o + 1] = d[o + 2] = v
      }
    }
    octx.putImageData(data, 0, 0)
    return toPng(out)
  }

  const [primary, alt] = await Promise.all([render(textIsBright), render(!textIsBright)])
  return { primary, alt }
}

/**
 * Finds the copy-count overlay in a card's corner and returns clean
 * black-on-white PNGs of up to MAX_GLYPH_GROUPS candidate glyph groups.
 */
async function quantityGlyphs(source, rect) {
  const scale = QTY_HEIGHT / rect.h
  const w = Math.max(1, Math.round(rect.w * scale))
  const h = QTY_HEIGHT
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, w, h)
  const px = ctx.getImageData(0, 0, w, h).data
  const lum = new Uint8ClampedArray(w * h)
  for (let i = 0, o = 0; i < lum.length; i++, o += 4) {
    lum[i] = 0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2]
  }

  const groups = findGlyphGroups(lum, w, h).slice(0, MAX_GLYPH_GROUPS)
  return Promise.all(
    groups.map(async (g) => {
      const mask = new OffscreenCanvas(g.w, g.h)
      const mctx = mask.getContext('2d')
      const img = mctx.createImageData(g.w, g.h)
      for (let i = 0; i < g.mask.length; i++) {
        const v = g.mask[i] ? 0 : 255
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v
        img.data[i * 4 + 3] = 255
      }
      mctx.putImageData(img, 0, 0)
      const s = GLYPH_HEIGHT / g.h
      const out = new OffscreenCanvas(Math.max(1, Math.round(g.w * s)), GLYPH_HEIGHT)
      const octx = out.getContext('2d')
      octx.imageSmoothingQuality = 'high'
      octx.drawImage(mask, 0, 0, out.width, out.height)
      return toPng(out)
    })
  )
}

async function fullImage(bitmap) {
  let scale = Math.min(3, Math.max(1, FULL_TARGET_WIDTH / bitmap.width))
  if (bitmap.width * bitmap.height * scale * scale > FULL_MAX_PIXELS) {
    scale = Math.max(1, Math.sqrt(FULL_MAX_PIXELS / (bitmap.width * bitmap.height)))
  }
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.filter = 'grayscale(1) contrast(1.15)'
  ctx.drawImage(bitmap, 0, 0, w, h)
  return toPng(canvas)
}

/**
 * @returns {Promise<{cards: Array<{rect, name, nameAlt, boxName?, boxNameAlt?, qtyGlyphs}>} | {full: Uint8Array}>}
 */
export async function prepareScreenshot(blob) {
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(bitmap, 0, 0)
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
    const rects = detectCardGrid(data, bitmap.width, bitmap.height)

    if (!rects.length) return { full: await fullImage(bitmap) }

    // YGOprodeck prints each card's name as a caption under the image; it
    // is far easier to read than the tiny name box on the card itself.
    const bg = dominantBorderColor(data, bitmap.width, bitmap.height)
    const cards = []
    for (const rect of rects) {
      const caption = findCaption(data, bitmap.width, bitmap.height, rect, bg)
      const [captionCrop, box, qtyGlyphs] = await Promise.all([
        caption ? cropVariants(bitmap, caption, NAME_HEIGHT) : null,
        cropVariants(bitmap, subRect(rect, NAME_REGION), NAME_HEIGHT),
        quantityGlyphs(bitmap, subRect(rect, QTY_REGION))
      ])
      const name = captionCrop || box
      cards.push({
        rect,
        name: name.primary,
        nameAlt: name.alt,
        // The name box helps tell apart captions cut off with "..."
        ...(captionCrop ? { boxName: box.primary, boxNameAlt: box.alt } : {}),
        qtyGlyphs
      })
    }
    return { cards }
  } finally {
    bitmap.close()
  }
}
