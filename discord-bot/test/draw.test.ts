import { describe, expect, it } from 'vitest'
import { cryptoRandomInt, drawPairs, shuffle } from '../src/logic/draw'
import { TournamentError } from '../src/logic/errors'

const PLAYERS = [11, 12, 13, 14, 15, 16, 17, 18]

describe('random draw', () => {
  it('makes 4 pairs that use all 8 players exactly once', () => {
    for (let i = 0; i < 200; i++) {
      const pairs = drawPairs(PLAYERS)
      expect(pairs).toHaveLength(4)
      for (const p of pairs) expect(p).toHaveLength(2)
      expect(pairs.flat().sort()).toEqual(PLAYERS)
    }
  })

  it('needs exactly 8 different players', () => {
    expect(() => drawPairs(PLAYERS.slice(0, 7))).toThrow(TournamentError)
    expect(() => drawPairs([...PLAYERS, 19])).toThrow(/exactly 8/)
    expect(() => drawPairs([11, 11, 13, 14, 15, 16, 17, 18])).toThrow(TournamentError)
  })

  it('is deterministic with an injected random source', () => {
    const noSwap = (n: number) => n - 1 // always pick the last element: identity shuffle
    expect(drawPairs(PLAYERS, noSwap)).toEqual([[11, 12], [13, 14], [15, 16], [17, 18]])
  })

  it('produces varied pairings (every player meets every other in round 1 eventually)', () => {
    const met = new Set<string>()
    for (let i = 0; i < 2000; i++) {
      for (const [a, b] of drawPairs(PLAYERS)) met.add([a, b].sort().join('-'))
    }
    expect(met.size).toBe(28) // 8 choose 2
  })

  it('cryptoRandomInt stays in range and covers it', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 500; i++) {
      const v = cryptoRandomInt(5)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(5)
      seen.add(v)
    }
    expect(seen.size).toBe(5)
  })

  it('shuffle does not modify its input', () => {
    const input = [...PLAYERS]
    shuffle(input)
    expect(input).toEqual(PLAYERS)
  })
})
