// Reading the options someone filled in on a slash command.
import { OptionType, type CommandOption, type DiscordUser, type Interaction } from './types'

export interface ParsedCommand {
  /** The subcommand, e.g. "add" for /player add. Empty if the command has none. */
  sub: string
  options: Record<string, string | number | boolean>
}

export function parseCommand(interaction: Interaction): ParsedCommand {
  let opts: CommandOption[] = interaction.data?.options ?? []
  let sub = ''
  // Walk into a subcommand group and/or subcommand if present.
  while (opts.length === 1 && (opts[0].type === OptionType.SUB_COMMAND || opts[0].type === OptionType.SUB_COMMAND_GROUP)) {
    sub = sub ? `${sub} ${opts[0].name}` : opts[0].name
    opts = opts[0].options ?? []
  }
  const options: ParsedCommand['options'] = {}
  for (const o of opts) if (o.value !== undefined) options[o.name] = o.value
  return { sub, options }
}

/** The full Discord user object for a user option (Discord sends it in `resolved`). */
export function resolvedUser(interaction: Interaction, id: string): DiscordUser | undefined {
  return interaction.data?.resolved?.users?.[id]
}
