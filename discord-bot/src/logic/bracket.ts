// The 8-player, 12-match bracket that decides every place from 1st to 8th.
// Pure logic with no Discord or database code, so it can be unit tested.
//
//   Round 1      M1  M2  M3  M4                  (random pairs)
//   Round 2      WA = W(M1) v W(M2)   WB = W(M3) v W(M4)   (winners' semis)
//                LA = L(M1) v L(M2)   LB = L(M3) v L(M4)   (losers' semis)
//   Round 3      P1 = W(WA) v W(WB)  -> 1st / 2nd
//                P3 = L(WA) v L(WB)  -> 3rd / 4th
//                P5 = W(LA) v W(LB)  -> 5th / 6th
//                P7 = L(LA) v L(LB)  -> 7th / 8th

import { TournamentError } from './errors'

export type PlayerId = number
export type BestOf = 1 | 3
export type Stage = 'R1' | 'WS' | 'LS' | 'P1' | 'P3' | 'P5' | 'P7'
export type Slot = 'M1' | 'M2' | 'M3' | 'M4' | 'WA' | 'WB' | 'LA' | 'LB' | 'P1' | 'P3' | 'P5' | 'P7'
export type MatchStatus = 'waiting' | 'ready' | 'pending' | 'disputed' | 'confirmed'
export type StageFormats = Record<Stage, BestOf>

export interface Feeder {
  slot: Slot
  take: 'winner' | 'loser'
}

interface SlotInfo {
  stage: Stage
  round: 1 | 2 | 3
  name: string
  feeders?: [Feeder, Feeder]
  /** For Round 3 matches: the place the winner gets (the loser gets the next one). */
  winnerPlace?: number
}

const W = (slot: Slot): Feeder => ({ slot, take: 'winner' })
const L = (slot: Slot): Feeder => ({ slot, take: 'loser' })

export const SLOTS: Record<Slot, SlotInfo> = {
  M1: { stage: 'R1', round: 1, name: 'Round 1 · Match 1' },
  M2: { stage: 'R1', round: 1, name: 'Round 1 · Match 2' },
  M3: { stage: 'R1', round: 1, name: 'Round 1 · Match 3' },
  M4: { stage: 'R1', round: 1, name: 'Round 1 · Match 4' },
  WA: { stage: 'WS', round: 2, name: "Winners' Semi A", feeders: [W('M1'), W('M2')] },
  WB: { stage: 'WS', round: 2, name: "Winners' Semi B", feeders: [W('M3'), W('M4')] },
  LA: { stage: 'LS', round: 2, name: "Losers' Semi A", feeders: [L('M1'), L('M2')] },
  LB: { stage: 'LS', round: 2, name: "Losers' Semi B", feeders: [L('M3'), L('M4')] },
  P1: { stage: 'P1', round: 3, name: 'Final (1st/2nd)', feeders: [W('WA'), W('WB')], winnerPlace: 1 },
  P3: { stage: 'P3', round: 3, name: '3rd/4th Place Match', feeders: [L('WA'), L('WB')], winnerPlace: 3 },
  P5: { stage: 'P5', round: 3, name: '5th/6th Place Match', feeders: [W('LA'), W('LB')], winnerPlace: 5 },
  P7: { stage: 'P7', round: 3, name: '7th/8th Place Match', feeders: [L('LA'), L('LB')], winnerPlace: 7 }
}

/** Every slot in bracket order. Later matches always come after their feeders. */
export const SLOT_ORDER: Slot[] = ['M1', 'M2', 'M3', 'M4', 'WA', 'WB', 'LA', 'LB', 'P1', 'P3', 'P5', 'P7']

export const STAGE_NAMES: Record<Stage, string> = {
  R1: 'Round 1',
  WS: "Winners' Semis",
  LS: "Losers' Semis",
  P1: 'Final (1st/2nd)',
  P3: '3rd/4th Place Match',
  P5: '5th/6th Place Match',
  P7: '7th/8th Place Match'
}

/** Matches the defaults seeded by migrations/0001_initial.sql. */
export const DEFAULT_STAGE_FORMATS: StageFormats = { R1: 1, WS: 1, LS: 1, P1: 3, P3: 1, P5: 1, P7: 1 }

/** How a feeder is written in the matches.feeder_a / feeder_b columns, e.g. "W:M1". */
export const feederCode = (f: Feeder) => `${f.take === 'winner' ? 'W' : 'L'}:${f.slot}`

export interface MatchState {
  slot: Slot
  stage: Stage
  bestOf: BestOf
  player1: PlayerId | null
  player2: PlayerId | null
  /** While pending/disputed this is the claimed winner; final once confirmed. */
  winner: PlayerId | null
  scoreP1: number | null
  scoreP2: number | null
  status: MatchStatus
}

/**
 * Who replaced whom mid-tournament (old player id -> new player id). A result
 * an old player already earned carries forward to their replacement.
 */
export type Substitutions = ReadonlyMap<PlayerId, PlayerId>

export function substitute(id: PlayerId, subs?: Substitutions): PlayerId {
  if (!subs) return id
  const seen = new Set<PlayerId>()
  while (subs.has(id) && !seen.has(id)) {
    seen.add(id)
    id = subs.get(id)!
  }
  return id
}

export type Pairs = [[PlayerId, PlayerId], [PlayerId, PlayerId], [PlayerId, PlayerId], [PlayerId, PlayerId]]

/** Builds a fresh tournament: Round 1 is ready to play, everything else waits. */
export function createBracket(pairs: Pairs, formats: StageFormats): MatchState[] {
  const players = pairs.flat()
  if (players.length !== 8 || new Set(players).size !== 8) {
    throw new TournamentError('A tournament needs 8 different players in 4 pairs.')
  }
  return SLOT_ORDER.map((slot) => {
    const info = SLOTS[slot]
    const pair = info.round === 1 ? pairs[Number(slot[1]) - 1] : null
    return {
      slot,
      stage: info.stage,
      bestOf: formats[info.stage],
      player1: pair ? pair[0] : null,
      player2: pair ? pair[1] : null,
      winner: null,
      scoreP1: null,
      scoreP2: null,
      status: pair ? 'ready' : 'waiting'
    }
  })
}

export const hasResult = (m: MatchState) => m.status === 'pending' || m.status === 'disputed' || m.status === 'confirmed'

function loserOf(m: MatchState): PlayerId | null {
  if (m.status !== 'confirmed' || m.winner === null) return null
  return m.winner === m.player1 ? m.player2 : m.player1
}

function feederPlayer(byslot: Map<Slot, MatchState>, f: Feeder, subs?: Substitutions): PlayerId | null {
  const m = byslot.get(f.slot)!
  const id = f.take === 'winner' ? (m.status === 'confirmed' ? m.winner : null) : loserOf(m)
  return id === null ? null : substitute(id, subs)
}

export interface ResolveResult {
  matches: MatchState[]
  /** Matches that had a reported or confirmed result which was thrown away. */
  reset: Slot[]
  /** Matches that just became playable with a new pair of players. */
  becameReady: Slot[]
}

/**
 * Works out who plays in every Round 2 and Round 3 match from the confirmed
 * results of their feeder matches. If a feeder's result changed so that a
 * match now has different players, that match is cleared, and so on down the
 * bracket. Matches whose players didn't change keep their results.
 */
export function resolveBracket(input: MatchState[], subs?: Substitutions): ResolveResult {
  const matches = input.map((m) => ({ ...m }))
  const byslot = new Map(matches.map((m) => [m.slot, m]))
  const reset: Slot[] = []
  const becameReady: Slot[] = []

  for (const slot of SLOT_ORDER) {
    const info = SLOTS[slot]
    if (!info.feeders) continue
    const m = byslot.get(slot)!
    const p1 = feederPlayer(byslot, info.feeders[0], subs)
    const p2 = feederPlayer(byslot, info.feeders[1], subs)
    const current1 = m.player1 === null ? null : substitute(m.player1, subs)
    const current2 = m.player2 === null ? null : substitute(m.player2, subs)
    if (p1 === current1 && p2 === current2) continue

    if (hasResult(m)) reset.push(slot)
    m.player1 = p1
    m.player2 = p2
    m.winner = null
    m.scoreP1 = null
    m.scoreP2 = null
    m.status = p1 !== null && p2 !== null ? 'ready' : 'waiting'
    // New players in a ready match means a new pairing, so it gets announced (again).
    if (m.status === 'ready') becameReady.push(slot)
  }
  return { matches, reset, becameReady }
}

export interface ResultInput {
  winner: PlayerId
  /** Games won by the winner and loser: 1-0 for Bo1, 2-0 or 2-1 for Bo3. */
  winnerGames: number
  loserGames: number
}

/** Checks a score against a match's format. Throws a friendly TournamentError. */
export function validateScore(bestOf: BestOf, winnerGames: number, loserGames: number): void {
  if (bestOf === 1) {
    if (winnerGames !== 1 || loserGames !== 0) {
      throw new TournamentError('This match is Best of 1, so the only possible score is 1-0.')
    }
    return
  }
  if (winnerGames !== 2 || (loserGames !== 0 && loserGames !== 1)) {
    throw new TournamentError('This match is Best of 3, so the score must be 2-0 or 2-1.')
  }
}

/**
 * Turns a score choice like "2-1" into winner/loser games. For Bo1 the score
 * can be left out. Throws a friendly TournamentError if it doesn't fit.
 */
export function parseScore(bestOf: BestOf, score?: string | null): { winnerGames: number; loserGames: number } {
  if (!score) {
    if (bestOf === 1) return { winnerGames: 1, loserGames: 0 }
    throw new TournamentError('This match is Best of 3. Please include the score (2-0 or 2-1).')
  }
  const match = score.trim().match(/^(\d)\s*-\s*(\d)$/)
  if (!match) throw new TournamentError(`"${score}" isn't a score. Use something like 2-1.`)
  const [a, b] = [Number(match[1]), Number(match[2])]
  const result = { winnerGames: Math.max(a, b), loserGames: Math.min(a, b) }
  validateScore(bestOf, result.winnerGames, result.loserGames)
  return result
}

function requirePlayable(m: MatchState): asserts m is MatchState & { player1: PlayerId; player2: PlayerId } {
  if (m.player1 === null || m.player2 === null) {
    throw new TournamentError(`${SLOTS[m.slot].name} can't be played yet: its earlier matches aren't finished.`)
  }
}

function setResult(m: MatchState, result: ResultInput, status: 'pending' | 'confirmed') {
  requirePlayable(m)
  if (result.winner !== m.player1 && result.winner !== m.player2) {
    throw new TournamentError('The winner must be one of the two players in this match.')
  }
  validateScore(m.bestOf, result.winnerGames, result.loserGames)
  const p1Won = result.winner === m.player1
  m.winner = result.winner
  m.scoreP1 = p1Won ? result.winnerGames : result.loserGames
  m.scoreP2 = p1Won ? result.loserGames : result.winnerGames
  m.status = status
}

function findMatch(matches: MatchState[], slot: Slot): MatchState {
  const m = matches.find((x) => x.slot === slot)
  if (!m) throw new Error(`No match in slot ${slot}`)
  return m
}

/**
 * Sets a final (confirmed) result and recalculates the rest of the bracket.
 * Used both when an opponent confirms a report and for admin overrides.
 */
export function applyResult(
  input: MatchState[],
  slot: Slot,
  result: ResultInput,
  subs?: Substitutions
): ResolveResult {
  const matches = input.map((m) => ({ ...m }))
  setResult(findMatch(matches, slot), result, 'confirmed')
  return resolveBracket(matches, subs)
}

/** Records a player's claimed result, waiting for the opponent to confirm. */
export function claimResult(input: MatchState[], slot: Slot, result: ResultInput): MatchState[] {
  const matches = input.map((m) => ({ ...m }))
  const m = findMatch(matches, slot)
  if (m.status === 'confirmed') throw new TournamentError('This match already has a confirmed result.')
  if (m.status === 'disputed') {
    throw new TournamentError('This result is disputed. An admin needs to settle it with /result override.')
  }
  setResult(m, result, 'pending')
  return matches
}

/** Marks a pending report as disputed. */
export function disputeResult(input: MatchState[], slot: Slot): MatchState[] {
  const matches = input.map((m) => ({ ...m }))
  const m = findMatch(matches, slot)
  if (m.status !== 'pending') throw new TournamentError('There is no reported result waiting for confirmation.')
  m.status = 'disputed'
  return matches
}

/** Confirms a pending report as final, then recalculates the bracket. */
export function confirmResult(input: MatchState[], slot: Slot, subs?: Substitutions): ResolveResult {
  const m = findMatch(input, slot)
  if (m.status !== 'pending' || m.winner === null) {
    throw new TournamentError('There is no reported result waiting for confirmation.')
  }
  const winnerGames = Math.max(m.scoreP1 ?? 0, m.scoreP2 ?? 0)
  const loserGames = Math.min(m.scoreP1 ?? 0, m.scoreP2 ?? 0)
  return applyResult(input, slot, { winner: m.winner, winnerGames, loserGames }, subs)
}

/**
 * Replaces a player in every match they haven't finished yet. Confirmed
 * results stay with the original player. Any pending claim in an affected
 * match is dropped, since the replacement must play it.
 */
export function swapPlayer(input: MatchState[], oldId: PlayerId, newId: PlayerId): MatchState[] {
  return input.map((m) => {
    if (m.status === 'confirmed' || (m.player1 !== oldId && m.player2 !== oldId)) return { ...m }
    const next = { ...m }
    if (next.player1 === oldId) next.player1 = newId
    if (next.player2 === oldId) next.player2 = newId
    next.winner = null
    next.scoreP1 = null
    next.scoreP2 = null
    next.status = next.player1 !== null && next.player2 !== null ? 'ready' : 'waiting'
    return next
  })
}

export const isComplete = (matches: MatchState[]) =>
  matches.length === 12 && matches.every((m) => m.status === 'confirmed')

export interface Placement {
  place: number
  playerId: PlayerId
}

/** Final places 1-8 from the four Round 3 matches. All must be confirmed. */
export function computePlacements(matches: MatchState[]): Placement[] {
  const placements: Placement[] = []
  for (const slot of ['P1', 'P3', 'P5', 'P7'] as const) {
    const m = findMatch(matches, slot)
    const loser = loserOf(m)
    if (m.winner === null || loser === null) {
      throw new TournamentError(`${SLOTS[slot].name} has no confirmed result yet.`)
    }
    placements.push({ place: SLOTS[slot].winnerPlace!, playerId: m.winner })
    placements.push({ place: SLOTS[slot].winnerPlace! + 1, playerId: loser })
  }
  return placements.sort((a, b) => a.place - b.place)
}

/** What would change if this result were set: used to warn before an override. */
export function previewResult(
  matches: MatchState[],
  slot: Slot,
  result: ResultInput,
  subs?: Substitutions
): { reset: Slot[] } {
  return { reset: applyResult(matches, slot, result, subs).reset }
}

/** Matches that can be played right now (both players known, not finished). */
export const playableMatches = (matches: MatchState[]) =>
  matches.filter((m) => m.status === 'ready' || m.status === 'pending' || m.status === 'disputed')
