import type { Env } from '../env'
import type { Interaction } from '../discord/types'
import { ping } from './ping'

export interface CommandContext {
  interaction: Interaction
  env: Env
  ctx: ExecutionContext
}

export interface Command {
  /** The JSON Discord needs to show the command (sent by `npm run register`). */
  definition: {
    name: string
    description: string
    options?: unknown[]
  }
  handle(c: CommandContext): Promise<Response> | Response
}

export const commands: Command[] = [ping]

export function findCommand(name: string | undefined): Command | undefined {
  return commands.find((c) => c.definition.name === name)
}
