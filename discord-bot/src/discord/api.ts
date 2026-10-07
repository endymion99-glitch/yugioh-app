// Sending and editing messages through Discord's REST API.
import type { Env } from '../env'
import { NO_MENTIONS } from './responses'
import type { MessagePayload } from './types'

const API = 'https://discord.com/api/v10'

export class DiscordApiError extends Error {
  constructor(
    public status: number,
    public body: string,
    path: string
  ) {
    super(`Discord API ${status} on ${path}: ${body}`)
    this.name = 'DiscordApiError'
  }

  /** Discord's own error code, e.g. 50001 for Missing Access. */
  get code(): number | undefined {
    try {
      return JSON.parse(this.body).code
    } catch {
      return undefined
    }
  }
}

/** Explains a failed post in plain words for the admin. */
export function describeDiscordError(err: unknown): string {
  if (err instanceof DiscordApiError) {
    if (err.code === 50001 || err.code === 50013 || err.status === 403) {
      return "I don't have permission to post there. Make sure the bot can View Channel, Send Messages and Embed Links in that channel."
    }
    if (err.code === 10003 || err.status === 404) return "That channel doesn't exist anymore. Set a new one with `/config channel`."
  }
  return 'Discord returned an error. Please try again in a moment.'
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export interface DiscordApi {
  createMessage(channelId: string, payload: MessagePayload): Promise<{ id: string }>
  editMessage(channelId: string, messageId: string, payload: MessagePayload): Promise<void>
  /** Edits the bot's reply to an interaction (also used after a deferred reply). */
  editOriginal(interactionToken: string, payload: MessagePayload): Promise<void>
  /** Sends an extra message after replying to an interaction. */
  followup(interactionToken: string, payload: MessagePayload): Promise<{ id: string }>
}

export function discordApi(env: Env): DiscordApi {
  async function call(method: string, path: string, payload: MessagePayload, auth: boolean): Promise<any> {
    const body = JSON.stringify({ allowed_mentions: NO_MENTIONS, ...payload })
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (auth) headers.authorization = `Bot ${env.DISCORD_BOT_TOKEN}`
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(API + path, { method, headers, body })
      if (res.status === 429 && attempt === 0) {
        // Rate limited: wait as long as Discord asks (capped), then retry once.
        const data = (await res.json().catch(() => ({}))) as { retry_after?: number }
        await sleep(Math.min((data.retry_after ?? 1) * 1000, 5000))
        continue
      }
      if (!res.ok) throw new DiscordApiError(res.status, await res.text(), path)
      return res.status === 204 ? null : res.json()
    }
  }
  const app = () => env.DISCORD_APPLICATION_ID
  return {
    createMessage: (channelId, payload) => call('POST', `/channels/${channelId}/messages`, payload, true),
    editMessage: async (channelId, messageId, payload) => {
      await call('PATCH', `/channels/${channelId}/messages/${messageId}`, payload, true)
    },
    editOriginal: async (token, payload) => {
      await call('PATCH', `/webhooks/${app()}/${token}/messages/@original`, payload, false)
    },
    followup: (token, payload) => call('POST', `/webhooks/${app()}/${token}`, payload, false)
  }
}
