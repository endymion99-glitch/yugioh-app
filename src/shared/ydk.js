// .ydk deck file parsing and writing.
//
//   #created by ...
//   #main
//   89631139
//   #extra
//   27548199
//   !side
//   44519536

/**
 * Parses a .ydk file. Returns per-section passcode counts plus the combined
 * count across all sections (what the importer adds to the collection).
 */
export function parseYdk(text) {
  const sections = { main: new Map(), extra: new Map(), side: new Map() }
  const all = new Map()
  let current = 'main'

  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const lower = line.toLowerCase()
    if (lower.startsWith('#main')) current = 'main'
    else if (lower.startsWith('#extra')) current = 'extra'
    else if (lower.startsWith('!side')) current = 'side'
    else if (/^\d+$/.test(line)) {
      const id = Number(line)
      if (id <= 0) continue
      sections[current].set(id, (sections[current].get(id) || 0) + 1)
      all.set(id, (all.get(id) || 0) + 1)
    }
    // Anything else (#created by, comments) is ignored.
  }
  return { sections, all }
}

/** Builds a .ydk file from {cardId, section, quantity} entries. */
export function buildYdk(entries, createdBy = 'YGO Collection Manager') {
  const out = [`#created by ${createdBy}`]
  for (const [section, header] of [
    ['main', '#main'],
    ['extra', '#extra'],
    ['side', '!side']
  ]) {
    out.push(header)
    for (const e of entries) {
      if (e.section !== section) continue
      for (let i = 0; i < e.quantity; i++) out.push(String(e.cardId))
    }
  }
  return out.join('\n') + '\n'
}
