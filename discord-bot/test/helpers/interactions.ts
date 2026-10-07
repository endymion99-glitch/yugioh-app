// Builds fake slash-command interactions and runs them through the bot.
import { handleInteraction } from '../../src/index'
import type { Env } from '../../src/env'
import { InteractionType, MessageFlags, OptionType } from '../../src/discord/types'
import { makeCtx, makeEnv } from './discord'

export const GUILD = 'guild-1'
export const ADMIN_ROLE = 'role-admin'
export const ADMINISTRATOR = String(1 << 3)

export interface Actor {
  id: string
  roles?: string[]
  permissions?: string
}

export const admin: Actor = { id: 'admin-user', roles: [ADMIN_ROLE] }
export const owner: Actor = { id: 'owner-user', permissions: ADMINISTRATOR }
export const member = (id: string): Actor => ({ id })

export interface Reply {
  type: number
  content: string
  ephemeral: boolean
  data: any
  /** Resolves when the work the bot continues after replying (ctx.waitUntil) is done. */
  done: Promise<unknown>
}

export interface RunOptions {
  /** User ids that should look like bots. */
  bots?: string[]
  /** The channel the command is run in. */
  channel?: string
}

export function makeTestEnv(): Env {
  return makeEnv('00'.repeat(32))
}

/**
 * Runs `/name sub option=value ...` as `actor`. Every string option value is
 * also listed as a resolved user, like Discord does for user options.
 */
export async function run(
  env: Env,
  actor: Actor,
  name: string,
  sub: string | null,
  options: Record<string, string | number | boolean> = {},
  { bots = [], channel = 'chan' }: RunOptions = {}
): Promise<Reply> {
  const opts = Object.entries(options).map(([n, value]) => ({ name: n, type: OptionType.STRING, value }))
  const users: Record<string, any> = {}
  for (const v of Object.values(options)) {
    if (typeof v === 'string') users[v] = { id: v, username: v, bot: bots.includes(v) }
  }
  const interaction = {
    id: 'i',
    application_id: 'app-id',
    type: InteractionType.APPLICATION_COMMAND,
    token: 'tok',
    guild_id: GUILD,
    channel_id: channel,
    member: { user: { id: actor.id, username: actor.id }, roles: actor.roles ?? [], permissions: actor.permissions ?? '0' },
    data: {
      name,
      options: sub ? [{ name: sub, type: OptionType.SUB_COMMAND, options: opts }] : opts,
      resolved: { users }
    }
  }
  const ctx = makeCtx()
  const res = await handleInteraction(interaction, env, ctx)
  const body = (await res.json()) as any
  return {
    done: Promise.all(ctx.pending),
    type: body.type,
    content: body.data?.content ?? '',
    ephemeral: Boolean((body.data?.flags ?? 0) & MessageFlags.EPHEMERAL),
    data: body.data
  }
}

/** Sets the admin role as the server owner, ready for admin commands. */
export async function setupAdmin(env: Env) {
  await run(env, owner, 'config', 'admin-role', { role: ADMIN_ROLE })
}

/** Sets the admin role and the tournament channel. */
export async function setupServer(env: Env, channel = TOURNAMENT_CHANNEL) {
  await setupAdmin(env)
  await run(env, admin, 'config', 'channel', { channel })
}

export const TOURNAMENT_CHANNEL = 'tournament-channel'

/** Adds players u1..u8 named P1..P8. */
export async function addEightPlayers(env: Env) {
  for (let i = 1; i <= 8; i++) await run(env, admin, 'player', 'add', { user: `u${i}`, name: `P${i}` })
}
