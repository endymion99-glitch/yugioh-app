// Placements, the points table and the rewards table.
import type { Placement } from '../logic/bracket'
import type { PlacementRecord, RewardRow } from '../logic/points'

/** Placements of every finished tournament (a tournament being corrected doesn't count until it's complete again). */
export async function loadFinishedPlacements(db: D1Database): Promise<PlacementRecord[]> {
  const { results } = await db
    .prepare(
      `SELECT p.tournament_id, p.player_id, p.place FROM placements p
       JOIN tournaments t ON t.id = p.tournament_id WHERE t.status = 'finished'`
    )
    .all<{ tournament_id: number; player_id: number; place: number }>()
  return results.map((r) => ({ tournamentId: r.tournament_id, playerId: r.player_id, place: r.place }))
}

export async function getPointsTable(db: D1Database): Promise<Map<number, number>> {
  const { results } = await db.prepare('SELECT place, points FROM points_table ORDER BY place').all<{ place: number; points: number }>()
  return new Map(results.map((r) => [r.place, r.points]))
}

export async function setPoints(db: D1Database, place: number, points: number): Promise<void> {
  await db
    .prepare('INSERT INTO points_table (place, points) VALUES (?, ?) ON CONFLICT (place) DO UPDATE SET points = excluded.points')
    .bind(place, points)
    .run()
}

export async function getRewardsTable(db: D1Database): Promise<RewardRow[]> {
  return (await db.prepare('SELECT place, base_packs, extra_packs, chosen_cards FROM rewards_table ORDER BY place').all<RewardRow>()).results
}

export async function setReward(db: D1Database, row: RewardRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO rewards_table (place, base_packs, extra_packs, chosen_cards) VALUES (?, ?, ?, ?)
       ON CONFLICT (place) DO UPDATE SET base_packs = excluded.base_packs, extra_packs = excluded.extra_packs,
         chosen_cards = excluded.chosen_cards`
    )
    .bind(row.place, row.base_packs, row.extra_packs, row.chosen_cards)
    .run()
}

/** Statements that replace a tournament's placements. */
export function replacePlacementsStatements(db: D1Database, tournamentId: number, placements: Placement[]): D1PreparedStatement[] {
  return [
    db.prepare('DELETE FROM placements WHERE tournament_id = ?').bind(tournamentId),
    ...placements.map((p) =>
      db.prepare('INSERT INTO placements (tournament_id, player_id, place) VALUES (?, ?, ?)').bind(tournamentId, p.playerId, p.place)
    )
  ]
}
