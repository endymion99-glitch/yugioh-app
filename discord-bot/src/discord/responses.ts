import { MessageFlags, ResponseType, type MessagePayload } from './types'

// No pings unless a caller explicitly lists who may be mentioned.
export const NO_MENTIONS = { parse: [] }

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

/** Reply to an interaction with a message. */
export function reply(message: MessagePayload | string, opts: { ephemeral?: boolean } = {}): Response {
  const data: MessagePayload = typeof message === 'string' ? { content: message } : { ...message }
  data.allowed_mentions ??= NO_MENTIONS
  if (opts.ephemeral) data.flags = (data.flags ?? 0) | MessageFlags.EPHEMERAL
  return json({ type: ResponseType.CHANNEL_MESSAGE, data })
}

/** A private reply only the person who ran the command can see. */
export function ephemeral(message: MessagePayload | string): Response {
  return reply(message, { ephemeral: true })
}
