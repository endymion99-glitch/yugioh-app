import { describe, expect, it } from 'vitest'
import { getConfig, getStageFormats } from '../src/db/config'
import { ADMIN_ROLE, GUILD, admin, makeTestEnv, member, owner, run, setupAdmin } from './helpers/interactions'

describe('/config admin-role', () => {
  it('can be set first by someone with Administrator or Manage Server', async () => {
    const env = makeTestEnv()
    const r = await run(env, owner, 'config', 'admin-role', { role: ADMIN_ROLE })
    expect(r.content).toMatch(/now tournament admins/)
    expect(r.content).toMatch(/don't have this role yourself/)
    expect(r.ephemeral).toBe(true)
    expect(await getConfig(env.DB, 'admin_role_id')).toBe(ADMIN_ROLE)

    const manager = { id: 'mgr', permissions: String(1 << 5) }
    expect((await run(env, manager, 'config', 'admin-role', { role: 'other' })).content).toMatch(/now tournament admins/)
  })

  it('is refused for regular members', async () => {
    const env = makeTestEnv()
    const r = await run(env, member('u1'), 'config', 'admin-role', { role: ADMIN_ROLE })
    expect(r.content).toMatch(/Manage Server/)
    expect(await getConfig(env.DB, 'admin_role_id')).toBeNull()
  })

  it('can be changed by a current admin, but @everyone is not allowed', async () => {
    const env = makeTestEnv()
    await setupAdmin(env)
    expect((await run(env, admin, 'config', 'admin-role', { role: 'role-2' })).content).toMatch(/now tournament admins/)
    expect((await run(env, owner, 'config', 'admin-role', { role: GUILD })).content).toMatch(/@everyone/)
  })
})

describe('admin-only commands', () => {
  it('explain that the admin role must be set first', async () => {
    const env = makeTestEnv()
    const r = await run(env, owner, 'config', 'channel', { channel: 'c1' })
    expect(r.content).toMatch(/No admin role has been set yet/)
  })

  it('refuse members without the admin role, even server owners', async () => {
    const env = makeTestEnv()
    await setupAdmin(env)
    expect((await run(env, member('u1'), 'config', 'channel', { channel: 'c1' })).content).toMatch(/Only members with/)
    expect((await run(env, owner, 'player', 'list')).content).toMatch(/Only members with/)
  })
})

describe('/config channel', () => {
  it('stores the tournament channel', async () => {
    const env = makeTestEnv()
    await setupAdmin(env)
    const r = await run(env, admin, 'config', 'channel', { channel: 'c1' })
    expect(r.content).toBe('Done. Tournament posts will go to <#c1>.')
    expect(await getConfig(env.DB, 'channel_id')).toBe('c1')
  })
})

describe('/config format', () => {
  it('changes the format for future tournaments', async () => {
    const env = makeTestEnv()
    await setupAdmin(env)
    const r = await run(env, admin, 'config', 'format', { stage: 'P3', best_of: 3 })
    expect(r.content).toMatch(/3rd\/4th Place Match\*\* is now \*\*Best of 3/)
    expect((await getStageFormats(env.DB)).P3).toBe(3)
  })

  it('optionally changes unreported matches of that stage in the current tournament', async () => {
    const env = makeTestEnv()
    await setupAdmin(env)
    const db = env.DB
    for (let i = 1; i <= 2; i++) await db.prepare('INSERT INTO players (name, discord_user_id) VALUES (?, ?)').bind(`P${i}`, `u${i}`).run()
    await db.prepare('INSERT INTO tournaments (number) VALUES (1)').run()
    const insert = db.prepare(
      "INSERT INTO matches (tournament_id, stage, slot, best_of, player1_id, player2_id, winner_id, score_p1, score_p2, status) VALUES (1, 'R1', ?, 1, 1, 2, ?, ?, ?, ?)"
    )
    await insert.bind('M1', null, null, null, 'ready').run()
    await insert.bind('M2', 1, 1, 0, 'confirmed').run()

    const r = await run(env, admin, 'config', 'format', { stage: 'R1', best_of: 3, apply_to_current: true })
    expect(r.content).toMatch(/1 match\(es\) were changed/)
    expect(r.content).toMatch(/1 match\(es\) already have a result/)
    const { results } = await db.prepare('SELECT slot, best_of FROM matches ORDER BY slot').all()
    expect(results).toEqual([{ slot: 'M1', best_of: 3 }, { slot: 'M2', best_of: 1 }])
  })

  it('says so when there is no current tournament', async () => {
    const env = makeTestEnv()
    await setupAdmin(env)
    const r = await run(env, admin, 'config', 'format', { stage: 'R1', best_of: 3, apply_to_current: true })
    expect(r.content).toMatch(/no tournament in progress/)
  })
})
