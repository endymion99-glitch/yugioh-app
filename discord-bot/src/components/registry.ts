// Button clicks. A button's custom_id starts with a prefix naming its handler.
import type { CommandContext } from '../commands/registry'
import { claimButtons } from './claim'
import { overrideButtons } from './override'

export interface ButtonHandler {
  prefix: string
  handle(c: CommandContext, parts: string[]): Promise<Response> | Response
}

const handlers: ButtonHandler[] = [claimButtons, overrideButtons]

export function findButtonHandler(customId: string | undefined): { handler: ButtonHandler; parts: string[] } | undefined {
  const parts = (customId ?? '').split(':')
  const handler = handlers.find((h) => h.prefix === parts[0])
  return handler ? { handler, parts: parts.slice(1) } : undefined
}
