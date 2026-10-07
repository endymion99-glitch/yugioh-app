// Who counts as a tournament admin.
import { TournamentError } from '../logic/errors'
import type { Interaction } from './types'

const ADMINISTRATOR = 1n << 3n
const MANAGE_GUILD = 1n << 5n

/** The member has Administrator or Manage Server. The server owner always has both. */
export function isServerManager(interaction: Interaction): boolean {
  const perms = BigInt(interaction.member?.permissions ?? '0')
  return (perms & ADMINISTRATOR) !== 0n || (perms & MANAGE_GUILD) !== 0n
}

export function hasRole(interaction: Interaction, roleId: string | null): boolean {
  return roleId !== null && (interaction.member?.roles ?? []).includes(roleId)
}

/** Throws a friendly error unless the member has the configured admin role. */
export function requireAdmin(interaction: Interaction, adminRoleId: string | null): void {
  if (!adminRoleId) {
    throw new TournamentError(
      'No admin role has been set yet. Someone with the Manage Server permission needs to run `/config admin-role` first.'
    )
  }
  if (!hasRole(interaction, adminRoleId)) {
    throw new TournamentError(`Only members with the <@&${adminRoleId}> role can use this command.`)
  }
}

/** The Discord user id of whoever triggered the interaction. */
export function userIdOf(interaction: Interaction): string {
  const id = interaction.member?.user.id ?? interaction.user?.id
  if (!id) throw new TournamentError('I could not tell who you are. Please try again.')
  return id
}

/** Commands only work inside the server, not in DMs with the bot. */
export function requireGuild(interaction: Interaction): void {
  if (!interaction.guild_id || !interaction.member) {
    throw new TournamentError('Please use this command in the server, not in a direct message.')
  }
}
