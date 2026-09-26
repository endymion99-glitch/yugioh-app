// Turns Tesseract line/word output from a YGOprodeck pack-opening screenshot
// into card-name candidates with quantities.
//
// Layout assumptions: cards sit in a grid, the name is printed at the top of
// each card, and duplicates show a small number ("2", "x2") near the card's
// bottom-right corner.

const QTY_RE = /^(?:[x×]\s*)?(\d{1,2})(?:\s*[x×])?$/i
const MIN_WORD_CONF = 20
const MIN_SEGMENT_CONF = 45
const MIN_QTY_CONF = 35

const cx = (b) => (b.x0 + b.x1) / 2
const cy = (b) => (b.y0 + b.y1) / 2
const height = (b) => b.y1 - b.y0

function median(nums) {
  if (!nums.length) return 0
  const s = [...nums].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function unionBox(words) {
  return {
    x0: Math.min(...words.map((w) => w.bbox.x0)),
    y0: Math.min(...words.map((w) => w.bbox.y0)),
    x1: Math.max(...words.map((w) => w.bbox.x1)),
    y1: Math.max(...words.map((w) => w.bbox.y1))
  }
}

/** Splits a line's words wherever the horizontal gap is much wider than the text is tall. */
function splitOnGaps(words) {
  if (!words.length) return []
  const sorted = [...words].sort((a, b) => a.bbox.x0 - b.bbox.x0)
  const h = median(sorted.map((w) => height(w.bbox))) || 1
  const groups = [[sorted[0]]]
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].bbox.x0 - sorted[i - 1].bbox.x1
    if (gap > h * 1.5) groups.push([sorted[i]])
    else groups[groups.length - 1].push(sorted[i])
  }
  return groups
}

/** Trims OCR noise from the ends of a name while keeping a trailing ellipsis. */
export function cleanOcrText(text) {
  let t = String(text)
    .replace(/[|_~`^*{}[\]<>«»“”"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const ellipsis = /(\.\.\.|…)$/.test(t)
  t = t.replace(/^[^A-Za-z0-9]+/, '').replace(/[^A-Za-z0-9!?)]+$/, '')
  return ellipsis && t ? `${t}...` : t
}

function looksLikeName(text) {
  const letters = (text.match(/[A-Za-z]/g) || []).length
  const visible = text.replace(/\s/g, '').length
  return letters >= 3 && letters / visible >= 0.6
}

/** Estimates grid spacing from where the name candidates sit. */
function estimateCardSize(segments) {
  const hs = median(segments.map((s) => height(s.bbox))) || 10
  const sorted = [...segments].sort((a, b) => cy(a.bbox) - cy(b.bbox))

  const rows = []
  for (const s of sorted) {
    const row = rows[rows.length - 1]
    if (row && Math.abs(cy(s.bbox) - row.y) <= hs) row.items.push(s)
    else rows.push({ y: cy(s.bbox), items: [s] })
  }

  const dxs = []
  for (const row of rows) {
    const xs = row.items.map((s) => cx(s.bbox)).sort((a, b) => a - b)
    for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] > hs * 3) dxs.push(xs[i] - xs[i - 1])
  }
  const dys = []
  for (let i = 1; i < rows.length; i++) {
    const dy = rows[i].y - rows[i - 1].y
    if (dy > hs * 4) dys.push(dy)
  }

  const widest = Math.max(0, ...segments.map((s) => s.bbox.x1 - s.bbox.x0))
  const width = median(dxs) || widest * 1.15 || hs * 12
  const heightEst = median(dys) || width * 1.46
  return { width, height: heightEst }
}

/**
 * @param {Array<{text:string, confidence:number, bbox:object, words:Array}>} lines
 * @returns {{ candidates: Array<{text:string, quantity:number, confidence:number, bbox:object}>,
 *             card: {width:number, height:number} }}
 */
export function extractCandidates(lines) {
  const segments = []
  const quantities = []

  for (const line of lines) {
    const words = (line.words || []).filter(
      (w) => w.text && w.text.trim() && w.confidence >= MIN_WORD_CONF
    )
    for (const group of splitOnGaps(words)) {
      const text = group.map((w) => w.text.trim()).join(' ')
      const conf = group.reduce((s, w) => s + w.confidence, 0) / group.length
      const bbox = unionBox(group)
      const qm = group.length === 1 ? text.match(QTY_RE) : null
      if (qm) {
        const value = Number(qm[1])
        if (value >= 1 && conf >= MIN_QTY_CONF) quantities.push({ value, bbox })
        continue
      }
      const cleaned = cleanOcrText(text)
      if (conf >= MIN_SEGMENT_CONF && looksLikeName(cleaned)) {
        segments.push({ text: cleaned, confidence: conf, bbox, quantity: 1, qtyFound: false })
      }
    }
  }

  const card = estimateCardSize(segments)

  // Attach each quantity to the nearest name above it in the same column.
  for (const q of quantities) {
    let best = null
    for (const s of segments) {
      const dy = cy(q.bbox) - cy(s.bbox)
      const dx = Math.abs(cx(q.bbox) - cx(s.bbox))
      if (s.bbox.y1 > q.bbox.y0 + height(q.bbox) / 2) continue
      if (dy > card.height * 1.15 || dx > card.width * 0.75) continue
      if (!best || dy < best.dy || (dy === best.dy && dx < best.dx)) best = { s, dy, dx }
    }
    if (best) {
      best.s.quantity = best.s.qtyFound ? Math.max(best.s.quantity, q.value) : q.value
      best.s.qtyFound = true
    }
  }

  return {
    candidates: segments.map(({ text, quantity, confidence, bbox }) => ({
      text,
      quantity,
      confidence,
      bbox
    })),
    card
  }
}

/**
 * Combines matched candidates into per-card quantities. Several detections of
 * the same card close together (e.g. a caption and the name box) are one
 * physical card; the same card in separate grid cells adds up.
 *
 * @param {Array<{cardId:number, quantity:number, bbox:object}>} matches
 * @returns {Map<number, number>} card id -> quantity
 */
export function mergeMatches(matches, card) {
  const byCard = new Map()
  for (const m of matches) {
    if (!byCard.has(m.cardId)) byCard.set(m.cardId, [])
    byCard.get(m.cardId).push(m)
  }
  const totals = new Map()
  for (const [cardId, list] of byCard) {
    const instances = []
    for (const m of list) {
      const inst = instances.find(
        (i) =>
          Math.abs(cx(i.bbox) - cx(m.bbox)) < card.width * 0.6 &&
          Math.abs(cy(i.bbox) - cy(m.bbox)) < card.height * 0.8
      )
      if (inst) inst.quantity = Math.max(inst.quantity, m.quantity)
      else instances.push({ bbox: m.bbox, quantity: m.quantity })
    }
    totals.set(cardId, instances.reduce((s, i) => s + i.quantity, 0))
  }
  return totals
}
