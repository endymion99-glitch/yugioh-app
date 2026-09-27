// Deck construction rules (standard Yu-Gi-Oh, no banlist).

import { isExtraDeckType } from './cardTypes.js'

export const RULES = {
  main: { min: 40, max: 60 },
  extra: { min: 0, max: 15 },
  side: { min: 0, max: 15 },
  maxCopies: 3
}

export const SECTIONS = ['main', 'extra', 'side']

/**
 * Validates a deck.
 *
 * @param {Array<{cardId:number, name?:string, type?:string,
 *                 section:'main'|'extra'|'side', quantity:number}>} entries
 * @param {Map<number, number>} [owned] collection quantities by card id; when
 *   given, the deck may not use more copies than the player owns.
 * @returns {{ counts: {main:number, extra:number, side:number},
 *             errors: Array<{code:string, message:string, cardId?:number}>,
 *             canSave: boolean }}
 */
export function validateDeck(entries, owned) {
  const counts = { main: 0, extra: 0, side: 0 }
  const perCard = new Map()
  const names = new Map()

  const errors = []
  const label = (id) => names.get(id) || `#${id}`

  for (const e of entries) {
    counts[e.section] += e.quantity
    perCard.set(e.cardId, (perCard.get(e.cardId) || 0) + e.quantity)
    if (e.name) names.set(e.cardId, e.name)
    if (e.type !== undefined) {
      const extra = isExtraDeckType(e.type)
      if ((e.section === 'main' && extra) || (e.section === 'extra' && !extra)) {
        errors.push({
          code: 'wrong-section',
          cardId: e.cardId,
          message: `${label(e.cardId)} belongs in the ${extra ? 'Extra' : 'Main'} Deck.`
        })
      }
    }
  }

  if (counts.main < RULES.main.min) {
    errors.push({
      code: 'main-too-small',
      message: `Main Deck has ${counts.main} cards — needs at least ${RULES.main.min}.`
    })
  }
  if (counts.main > RULES.main.max) {
    errors.push({
      code: 'main-too-large',
      message: `Main Deck has ${counts.main} cards — maximum is ${RULES.main.max}.`
    })
  }
  if (counts.extra > RULES.extra.max) {
    errors.push({
      code: 'extra-too-large',
      message: `Extra Deck has ${counts.extra} cards — maximum is ${RULES.extra.max}.`
    })
  }
  if (counts.side > RULES.side.max) {
    errors.push({
      code: 'side-too-large',
      message: `Side Deck has ${counts.side} cards — maximum is ${RULES.side.max}.`
    })
  }

  for (const [cardId, n] of perCard) {
    if (n > RULES.maxCopies) {
      errors.push({
        code: 'too-many-copies',
        cardId,
        message: `${label(cardId)}: ${n} copies — maximum is ${RULES.maxCopies} across Main, Extra and Side.`
      })
    }
    if (owned) {
      const have = owned.get(cardId) || 0
      if (n > have) {
        errors.push({
          code: 'not-owned',
          cardId,
          message: `${label(cardId)}: deck uses ${n} but your collection has ${have}.`
        })
      }
    }
  }

  return { counts, errors, canSave: errors.length === 0 }
}

/**
 * How many more copies of a card can be put in the deck, given the
 * collection. Only ownership blocks adding; the 3-copy rule is reported by
 * validateDeck so the player sees it as a live error.
 */
export function availableCopies(cardId, entries, owned) {
  const used = entries
    .filter((e) => e.cardId === cardId)
    .reduce((sum, e) => sum + e.quantity, 0)
  return Math.max(0, (owned.get(cardId) || 0) - used)
}
