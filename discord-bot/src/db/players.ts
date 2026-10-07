// The roster: players linked to Discord accounts.
export interface Player {
  id: number
  name: string
  discord_user_id: string
  active: number
  created_at: string
}

export async function listPlayers(db: D1Database, opts: { activeOnly?: boolean } = {}): Promise<Player[]> {
  const sql = opts.activeOnly
    ? 'SELECT * FROM players WHERE active = 1 ORDER BY name COLLATE NOCASE'
    : 'SELECT * FROM players ORDER BY active DESC, name COLLATE NOCASE'
  return (await db.prepare(sql).all<Player>()).results
}

export async function getActivePlayerByDiscordId(db: D1Database, discordUserId: string): Promise<Player | null> {
  return db.prepare('SELECT * FROM players WHERE discord_user_id = ? AND active = 1').bind(discordUserId).first<Player>()
}

export async function getActivePlayerByName(db: D1Database, name: string): Promise<Player | null> {
  return db
    .prepare('SELECT * FROM players WHERE active = 1 AND name = ? COLLATE NOCASE')
    .bind(name)
    .first<Player>()
}

export async function getPlayersByIds(db: D1Database, ids: number[]): Promise<Map<number, Player>> {
  if (ids.length === 0) return new Map()
  const unique = [...new Set(ids)]
  const { results } = await db
    .prepare(`SELECT * FROM players WHERE id IN (${unique.map(() => '?').join(', ')})`)
    .bind(...unique)
    .all<Player>()
  return new Map(results.map((p) => [p.id, p]))
}

export const insertPlayerStatement = (db: D1Database, name: string, discordUserId: string) =>
  db.prepare('INSERT INTO players (name, discord_user_id, active) VALUES (?, ?, 1)').bind(name, discordUserId)

export const deactivatePlayerStatement = (db: D1Database, id: number) =>
  db.prepare('UPDATE players SET active = 0 WHERE id = ?').bind(id)
