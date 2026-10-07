// What happens once all 12 matches of a tournament are confirmed.
import type { Tournament } from '../db/tournaments'
import type { Env } from '../env'

/**
 * Called when the last match of a tournament is confirmed (or, for a
 * tournament being corrected, when it is complete again).
 * Placements, points, the summary and the next draw arrive in build step 7.
 */
export async function onTournamentComplete(_env: Env, _tournament: Tournament): Promise<void> {}
