// The small subset of Discord's interaction API this bot uses.
// Reference: https://discord.com/developers/docs/interactions/receiving-and-responding

export const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  APPLICATION_COMMAND_AUTOCOMPLETE: 4,
  MODAL_SUBMIT: 5
} as const

export const ResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE: 4,
  DEFERRED_CHANNEL_MESSAGE: 5,
  DEFERRED_UPDATE_MESSAGE: 6,
  UPDATE_MESSAGE: 7
} as const

export const MessageFlags = {
  EPHEMERAL: 1 << 6
} as const

export const OptionType = {
  SUB_COMMAND: 1,
  SUB_COMMAND_GROUP: 2,
  STRING: 3,
  INTEGER: 4,
  BOOLEAN: 5,
  USER: 6,
  CHANNEL: 7,
  ROLE: 8
} as const

export interface DiscordUser {
  id: string
  username: string
  global_name?: string | null
  bot?: boolean
}

export interface GuildMember {
  user: DiscordUser
  roles: string[]
  /** The member's computed permissions in the channel, as a decimal string bitfield. */
  permissions: string
  nick?: string | null
}

export interface CommandOption {
  name: string
  type: number
  value?: string | number | boolean
  options?: CommandOption[]
  focused?: boolean
}

export interface Interaction {
  id: string
  application_id: string
  type: number
  token: string
  guild_id?: string
  channel_id?: string
  member?: GuildMember
  user?: DiscordUser
  data?: {
    name?: string
    options?: CommandOption[]
    custom_id?: string
    component_type?: number
    resolved?: { users?: Record<string, DiscordUser> }
  }
  message?: { id: string; channel_id: string }
}

export interface AllowedMentions {
  parse?: Array<'users' | 'roles' | 'everyone'>
  users?: string[]
  roles?: string[]
}

export interface MessagePayload {
  content?: string
  embeds?: unknown[]
  components?: unknown[]
  flags?: number
  allowed_mentions?: AllowedMentions
}

export const ComponentType = {
  ACTION_ROW: 1,
  BUTTON: 2
} as const

export const ButtonStyle = {
  PRIMARY: 1,
  SECONDARY: 2,
  SUCCESS: 3,
  DANGER: 4
} as const

export function buttonRow(...buttons: Array<{ label: string; custom_id: string; style: number }>) {
  return { type: ComponentType.ACTION_ROW, components: buttons.map((b) => ({ type: ComponentType.BUTTON, ...b })) }
}
