// Locates large text glyphs (the copy-count overlay) inside a card's corner.
//
// Tesseract struggles to find a lone digit inside a busy crop, but reads it
// reliably from a tight, clean black-on-white image. This finds candidate
// glyph groups with an adaptive threshold + connected components and renders
// each group's pixel mask as such an image.

const THRESHOLD = 22

/**
 * @param {Uint8ClampedArray|Uint8Array} lum greyscale pixels, row-major
 * @returns {Array<{x0,y0,x1,y1, mask: Uint8Array, w:number, h:number}>}
 *   glyph groups, most likely overlay first. `mask` covers the group's
 *   bounding box plus a margin; 1 = ink.
 */
export function findGlyphGroups(lum, w, h) {
  // Integral image for local means.
  const I = new Float64Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let s = 0
    for (let x = 0; x < w; x++) {
      s += lum[y * w + x]
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + s
    }
  }
  const r = Math.max(4, Math.round(h * 0.25))
  const mean = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(h, y + r + 1)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(w, x + r + 1)
      const sum = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]
      mean[y * w + x] = sum / ((x1 - x0) * (y1 - y0))
    }
  }

  const groups = []
  for (const polarity of [1, -1]) {
    // polarity 1: bright ink on darker surroundings; -1: dark ink.
    const ink = new Uint8Array(w * h)
    for (let i = 0; i < w * h; i++) ink[i] = polarity * (lum[i] - mean[i]) > THRESHOLD ? 1 : 0
    const comps = components(ink, w, h).filter((c) => isGlyphLike(c, w, h))
    for (const g of groupComponents(comps)) groups.push({ ...g, polarity })
  }

  // The overlay sits at the bottom-right: prefer groups nearest that corner.
  groups.sort((a, b) => b.x1 + b.y1 - (a.x1 + a.y1))
  return groups.map((g) => renderMask(g, w, h))
}

function components(ink, w, h) {
  const label = new Int32Array(w * h)
  const out = []
  const stack = []
  let next = 1
  for (let start = 0; start < w * h; start++) {
    if (!ink[start] || label[start]) continue
    const c = { id: next, x0: w, y0: h, x1: 0, y1: 0, area: 0, pixels: [] }
    label[start] = next
    stack.push(start)
    while (stack.length) {
      const i = stack.pop()
      const x = i % w
      const y = (i - x) / w
      c.area++
      c.pixels.push(i)
      if (x < c.x0) c.x0 = x
      if (y < c.y0) c.y0 = y
      if (x + 1 > c.x1) c.x1 = x + 1
      if (y + 1 > c.y1) c.y1 = y + 1
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && ink[j] && !label[j]) {
          label[j] = next
          stack.push(j)
        }
      }
    }
    out.push(c)
    next++
  }
  return out
}

function isGlyphLike(c, w, h) {
  const cw = c.x1 - c.x0
  const ch = c.y1 - c.y0
  if (c.x0 === 0 || c.y0 === 0 || c.x1 === w || c.y1 === h) return false
  if (ch < h * 0.13 || ch > h * 0.6) return false
  if (cw < ch * 0.12 || cw > ch * 1.1) return false
  const fill = c.area / (cw * ch)
  if (fill < 0.12 || fill > 0.8) return false
  return !isFrameCorner(c, w)
}

// A card frame's corner shows up as an open "L": ink along the whole right
// column and bottom row of the bounding box but not along the left or top
// (a boxy "0" has all four). Digits never look like that.
function isFrameCorner(c, w) {
  const cw = c.x1 - c.x0
  const ch = c.y1 - c.y0
  const right = new Set()
  const bottom = new Set()
  const left = new Set()
  const top = new Set()
  for (const i of c.pixels) {
    const x = i % w
    const y = (i - x) / w
    if (x >= c.x1 - 2) right.add(y)
    if (y >= c.y1 - 2) bottom.add(x)
    if (x < c.x0 + 2) left.add(y)
    if (y < c.y0 + 2) top.add(x)
  }
  return (
    right.size >= ch * 0.8 && bottom.size >= cw * 0.8 && left.size < ch * 0.5 && top.size < cw * 0.5
  )
}

function groupComponents(comps) {
  const sorted = [...comps].sort((a, b) => a.x0 - b.x0)
  const groups = []
  for (const c of sorted) {
    const ch = c.y1 - c.y0
    const g = groups.find((g) => {
      const gh = g.y1 - g.y0
      const overlap = Math.min(g.y1, c.y1) - Math.max(g.y0, c.y0)
      return (
        overlap >= 0.5 * Math.min(gh, ch) &&
        c.x0 - g.x1 <= 0.6 * gh &&
        ch / gh > 0.5 &&
        ch / gh < 1.8
      )
    })
    if (g) {
      g.x0 = Math.min(g.x0, c.x0)
      g.y0 = Math.min(g.y0, c.y0)
      g.x1 = Math.max(g.x1, c.x1)
      g.y1 = Math.max(g.y1, c.y1)
      g.members.push(c)
    } else {
      groups.push({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1, members: [c] })
    }
  }
  // At most 3 glyphs ("x10") make a quantity.
  return groups.filter((g) => g.members.length <= 3)
}

function renderMask(g, w, _h) {
  const gh = g.y1 - g.y0
  const m = Math.round(gh * 0.4)
  const mw = g.x1 - g.x0 + 2 * m
  const mh = gh + 2 * m
  const mask = new Uint8Array(mw * mh)
  for (const c of g.members) {
    for (const i of c.pixels) {
      const x = (i % w) - g.x0 + m
      const y = Math.floor(i / w) - g.y0 + m
      mask[y * mw + x] = 1
    }
  }
  return { x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1, mask, w: mw, h: mh }
}
