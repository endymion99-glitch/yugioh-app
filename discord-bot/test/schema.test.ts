import { describe, expect, it } from 'vitest'
import { createTestDb } from './helpers/d1'

async function addPlayers(db: D1Database, n: number) {
  for (let i = 1; i <= n; i++) {
    await db.prepare('INSERT INTO players (name, discord_user_id) VALUES (?, ?)').bind(`P${i}`, `u${i}`).run()
  }
}

describe('database schema (migrations)', () => {
  it('seeds the default stage formats: Bo1 everywhere except the final (Bo3)', async () => {
    const db = createTestDb()
    const { results } = await db.prepare('SELECT stage, best_of FROM stage_formats ORDER BY stage').all()
    expect(Object.fromEntries(results.map((r: any) => [r.stage, r.best_of]))).toEqual({
      LS: 1, P1: 3, P3: 1, P5: 1, P7: 1, R1: 1, WS: 1
    })
  })

  it('seeds the default points table', async () => {
    const db = createTestDb()
    const { results } = await db.prepare('SELECT points FROM points_table ORDER BY place').all()
    expect(results.map((r: any) => r.points)).toEqual([10, 8, 7, 6, 5, 4, 3, 1])
  })

  it('seeds the default rewards table', async () => {
    const db = createTestDb()
    const { results } = await db.prepare('SELECT * FROM rewards_table ORDER BY place').all()
    expect(results).toEqual([
      { place: 1, base_packs: 10, extra_packs: 0, chosen_cards: 4 },
      { place: 2, base_packs: 10, extra_packs: 0, chosen_cards: 3 },
      { place: 3, base_packs: 10, extra_packs: 0, chosen_cards: 2 },
      { place: 4, base_packs: 10, extra_packs: 0, chosen_cards: 1 },
      { place: 5, base_packs: 10, extra_packs: 4, chosen_cards: 0 },
      { place: 6, base_packs: 10, extra_packs: 6, chosen_cards: 0 },
      { place: 7, base_packs: 10, extra_packs: 8, chosen_cards: 0 },
      { place: 8, base_packs: 10, extra_packs: 10, chosen_cards: 0 }
    ])
  })

  it('allows only one tournament in progress at a time', async () => {
    const db = createTestDb()
    await db.prepare("INSERT INTO tournaments (number) VALUES (1)").run()
    await expect(db.prepare("INSERT INTO tournaments (number) VALUES (2)").run()).rejects.toThrow(/UNIQUE/)
    await db.prepare("UPDATE tournaments SET status = 'finished' WHERE number = 1").run()
    await db.prepare("INSERT INTO tournaments (number) VALUES (2)").run()
  })

  it('links a Discord user to at most one active player', async () => {
    const db = createTestDb()
    await addPlayers(db, 1)
    const insert = db.prepare('INSERT INTO players (name, discord_user_id, active) VALUES (?, ?, ?)')
    await expect(insert.bind('Again', 'u1', 1).run()).rejects.toThrow(/UNIQUE/)
    await insert.bind('Old record', 'u1', 0).run() // inactive duplicates are fine
  })

  it('rejects a winner who is not in the match, and duplicate slots', async () => {
    const db = createTestDb()
    await addPlayers(db, 3)
    await db.prepare("INSERT INTO tournaments (number) VALUES (1)").run()
    const insert = db.prepare(
      "INSERT INTO matches (tournament_id, stage, slot, best_of, player1_id, player2_id, winner_id) VALUES (1, 'R1', ?, 1, 1, 2, ?)"
    )
    await insert.bind('M1', 1).run()
    await expect(insert.bind('M2', 3).run()).rejects.toThrow(/CHECK/)
    await expect(insert.bind('M1', 2).run()).rejects.toThrow(/UNIQUE/)
  })

  it('rejects invalid formats and unknown stages', async () => {
    const db = createTestDb()
    await expect(db.prepare("UPDATE stage_formats SET best_of = 5 WHERE stage = 'R1'").run()).rejects.toThrow(/CHECK/)
    await expect(db.prepare("INSERT INTO stage_formats VALUES ('XX', 1)").run()).rejects.toThrow(/CHECK/)
  })

  it('rolls back a whole batch when one statement fails', async () => {
    const db = createTestDb()
    await expect(
      db.batch([
        db.prepare("INSERT INTO config (key, value) VALUES ('channel_id', '1')"),
        db.prepare("INSERT INTO points_table (place, points) VALUES (9, 0)")
      ])
    ).rejects.toThrow()
    expect(await db.prepare('SELECT COUNT(*) AS n FROM config').first('n')).toBe(0)
  })
})
