import { ephemeral } from '../discord/responses'
import type { Command } from './registry'

// A harmless test command to confirm the bot is wired up correctly.
export const ping: Command = {
  definition: {
    name: 'ping',
    description: 'Check that the tournament bot is online'
  },
  handle() {
    return ephemeral('Pong! The tournament bot is online.')
  }
}
