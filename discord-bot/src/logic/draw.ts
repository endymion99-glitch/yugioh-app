// The random draw for Round 1.
import { TournamentError } from './errors'
import type { Pairs, PlayerId } from './bracket'

/** Returns a uniformly random integer in [0, n). */
export type RandomInt = (n: number) => number

/** Cryptographically strong randomness (Web Crypto, available in Workers). */
export const cryptoRandomInt: RandomInt = (n) => {
  // Rejection sampling avoids the slight bias of a plain modulo.
  const limit = Math.floor(0x1_0000_0000 / n) * n
  const buf = new Uint32Array(1)
  do crypto.getRandomValues(buf)
  while (buf[0] >= limit)
  return buf[0] % n
}

/** Fisher-Yates shuffle; returns a new array. */
export function shuffle<T>(items: readonly T[], randomInt: RandomInt = cryptoRandomInt): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Shuffles exactly 8 players into the 4 Round 1 pairs (M1 to M4). */
export function drawPairs(players: readonly PlayerId[], randomInt: RandomInt = cryptoRandomInt): Pairs {
  if (players.length !== 8 || new Set(players).size !== 8) {
    throw new TournamentError(`A draw needs exactly 8 active players, but there are ${new Set(players).size}.`)
  }
  const s = shuffle(players, randomInt)
  return [
    [s[0], s[1]],
    [s[2], s[3]],
    [s[4], s[5]],
    [s[6], s[7]]
  ]
}
