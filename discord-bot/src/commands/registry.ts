import type { Env } from '../env'
import type { Interaction } from '../discord/types'
import { config } from './config'
import { draw } from './draw'
import { ping } from './ping'
import { player } from './player'
import { report } from './report'
import { result } from './result'
import { tournament } from './tournament'

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

export const commands: Command[] = [ping, config, player, draw, tournament, report, result]

export function findCommand(name: string | undefined): Command | undefined {
  return commands.find((c) => c.definition.name === name)
}
