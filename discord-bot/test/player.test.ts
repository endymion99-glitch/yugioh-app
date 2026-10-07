import { describe, expect, it } from 'vitest'
import { listPlayers } from '../src/db/players'
import { loadMatches, loadSubstitutions } from '../src/db/tournaments'
import { DEFAULT_STAGE_FORMATS, applyResult, createBracket, feederCode, SLOTS } from '../src/logic/bracket'
import type { Env } from '../src/env'
import { addEightPlayers, admin, makeTestEnv, run, setupAdmin } from './helpers/interactions'

async function ready() {
  const env = makeTestEnv()
  await setupAdmin(env)
  return env
}

/** Creates tournament #1 for the 8 active players directly in the database (the /draw command comes in step 5). */
async function startTournament(env: Env) {
  const ids = (await listPlayers(env.DB, { activeOnly: true })).map((p) => p.id).sort((a, b) => a - b)
  const { meta } = await env.DB.prepare('INSERT INTO tournaments (number) VALUES (1)').run()
  let matches = createBracket([[ids[0], ids[1]], [ids[2], ids[3]], [ids[4], ids[5]], [ids[6], ids[7]]], DEFAULT_STAGE_FORMATS)
  matches = applyResult(matches, 'M1', { winner: ids[0], winnerGames: 1, loserGames: 0 }).matches
  await env.DB.batch(
    matches.map((m) => {
      const f = SLOTS[m.slot].feeders
      return env.DB.prepare(
        'INSERT INTO matches (tournament_id, stage, slot, best_of, player1_id, player2_id, winner_id, score_p1, score_p2, status, feeder_a, feeder_b) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(meta.last_row_id, m.stage, m.slot, m.bestOf, m.player1, m.player2, m.winner, m.scoreP1, m.scoreP2, m.status, f ? feederCode(f[0]) : null, f ? feederCode(f[1]) : null)
    })
  )
  return { tournamentId: meta.last_row_id, ids }
}

describe('/player add', () => {
  it('adds players up to 8 and says when the roster is complete', async () => {
    const env = await ready()
    const first = await run(env, admin, 'player', 'add', { user: 'u1', name: '  Yugi   Muto ' })
    expect(first.content).toBe('Added **Yugi Muto** (<@u1>). Active players: 1/8. 7 more to go.')
    for (let i = 2; i <= 7; i++) await run(env, admin, 'player', 'add', { user: `u${i}`, name: `P${i}` })
    const last = await run(env, admin, 'player', 'add', { user: 'u8', name: 'P8' })
    expect(last.content).toMatch(/8\/8\. All 8 players are in/)

    const ninth = await run(env, admin, 'player', 'add', { user: 'u9', name: 'P9' })
    expect(ninth.content).toMatch(/already 8 active players/)
    expect(await listPlayers(env.DB, { activeOnly: true })).toHaveLength(8)
  })

  it('refuses duplicates, bots and blank names', async () => {
    const env = await ready()
    await run(env, admin, 'player', 'add', { user: 'u1', name: 'Kaiba' })
    expect((await run(env, admin, 'player', 'add', { user: 'u1', name: 'Other' })).content).toMatch(/already linked/)
    expect((await run(env, admin, 'player', 'add', { user: 'u2', name: 'kaiba' })).content).toMatch(/already an active player called/)
    expect((await run(env, admin, 'player', 'add', { user: 'bot1', name: 'Robo' }, ['bot1'])).content).toMatch(/Bots/)
    expect((await run(env, admin, 'player', 'add', { user: 'u3', name: '   ' })).content).toMatch(/give the player a name/)
  })

  it('escapes Discord formatting in names', async () => {
    const env = await ready()
    const r = await run(env, admin, 'player', 'add', { user: 'u1', name: '*Joey*' })
    expect(r.content).toContain('**\\*Joey\\***')
  })
})

describe('/player list', () => {
  it('shows active and former players', async () => {
    const env = await ready()
    await addEightPlayers(env)
    await run(env, admin, 'player', 'remove', { user: 'u8' })
    const r = await run(env, admin, 'player', 'list')
    expect(r.content).toMatch(/Active players \(7\/8\)/)
    expect(r.content).toContain('1. **P1** (<@u1>)')
    expect(r.content).toMatch(/Former players:\*\* P8/)
  })
})

describe('/player remove', () => {
  it('deactivates a player but keeps their record', async () => {
    const env = await ready()
    await addEightPlayers(env)
    expect((await run(env, admin, 'player', 'remove', { user: 'u3' })).content).toMatch(/Removed \*\*P3\*\*/)
    const all = await listPlayers(env.DB)
    expect(all).toHaveLength(8)
    expect(all.find((p) => p.name === 'P3')!.active).toBe(0)
    expect((await run(env, admin, 'player', 'remove', { user: 'u3' })).content).toMatch(/not an active player/)
  })

  it('is refused while the player is in a tournament', async () => {
    const env = await ready()
    await addEightPlayers(env)
    await startTournament(env)
    expect((await run(env, admin, 'player', 'remove', { user: 'u2' })).content).toMatch(/Use `\/player swap`/)
  })
})

describe('/player swap', () => {
  it('replaces a player between tournaments with a fresh record', async () => {
    const env = await ready()
    await addEightPlayers(env)
    const r = await run(env, admin, 'player', 'swap', { old: 'u2', new: 'u9', name: 'Mai' })
    expect(r.content).toMatch(/\*\*Mai\*\* \(<@u9>\) replaced \*\*P2\*\* \(<@u2>\)/)
    const active = await listPlayers(env.DB, { activeOnly: true })
    expect(active.map((p) => p.name).sort()).toEqual(['Mai', 'P1', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'])
  })

  it('mid-tournament: the replacement takes over unplayed matches, played ones stay', async () => {
    const env = await ready()
    await addEightPlayers(env)
    const { tournamentId, ids } = await startTournament(env) // M1: P1 beat P2 (confirmed)

    // Replace P1, who has won M1 and is waiting in Winners' Semi A.
    const r = await run(env, admin, 'player', 'swap', { old: 'u1', new: 'u9', name: 'Mai' })
    expect(r.content).toMatch(/Tournament #1/)
    const mai = (await listPlayers(env.DB, { activeOnly: true })).find((p) => p.name === 'Mai')!

    const matches = await loadMatches(env.DB, tournamentId)
    const m1 = matches.find((m) => m.slot === 'M1')!
    expect(m1).toMatchObject({ player1: ids[0], winner: ids[0], status: 'confirmed' }) // stays with P1
    expect(matches.find((m) => m.slot === 'WA')!.player1).toBe(mai.id)
    expect(await loadSubstitutions(env.DB, tournamentId)).toEqual(new Map([[ids[0], mai.id]]))
  })

  it('mid-tournament: an unplayed Round 1 match is taken over and listed', async () => {
    const env = await ready()
    await addEightPlayers(env)
    const { tournamentId } = await startTournament(env)
    const r = await run(env, admin, 'player', 'swap', { old: 'u4', new: 'u9', name: 'Mai' })
    expect(r.content).toMatch(/they take over: Round 1 · Match 2/)
    const m2 = (await loadMatches(env.DB, tournamentId)).find((m) => m.slot === 'M2')!
    const mai = (await listPlayers(env.DB, { activeOnly: true })).find((p) => p.name === 'Mai')!
    expect(m2.player2).toBe(mai.id)
  })

  it('refuses invalid swaps', async () => {
    const env = await ready()
    await addEightPlayers(env)
    expect((await run(env, admin, 'player', 'swap', { old: 'u9', new: 'u10', name: 'X' })).content).toMatch(/not an active player/)
    expect((await run(env, admin, 'player', 'swap', { old: 'u1', new: 'u2', name: 'X' })).content).toMatch(/already an active player/)
    expect((await run(env, admin, 'player', 'swap', { old: 'u1', new: 'u1', name: 'X' })).content).toMatch(/different Discord user/)
    expect((await run(env, admin, 'player', 'swap', { old: 'u1', new: 'u9', name: 'P3' })).content).toMatch(/already an active player called/)
    // Reusing the leaving player's own name is fine.
    expect((await run(env, admin, 'player', 'swap', { old: 'u1', new: 'u9', name: 'P1' })).content).toMatch(/replaced/)
  })
})
