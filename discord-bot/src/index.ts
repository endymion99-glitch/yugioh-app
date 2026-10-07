import { findCommand } from './commands/registry'
import { findButtonHandler } from './components/registry'
import { ephemeral, json } from './discord/responses'
import { InteractionType, ResponseType, type Interaction } from './discord/types'
import { verifyDiscordSignature } from './discord/verify'
import type { Env } from './env'
import { TournamentError } from './logic/errors'

export async function handleInteraction(
  interaction: Interaction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  switch (interaction.type) {
    case InteractionType.PING:
      return json({ type: ResponseType.PONG })

    case InteractionType.APPLICATION_COMMAND: {
      const command = findCommand(interaction.data?.name)
      if (!command) return ephemeral("Sorry, I don't know that command.")
      try {
        return await command.handle({ interaction, env, ctx })
      } catch (err) {
        // Expected problems (not in this match, not an admin...) are shown to the user as-is.
        if (err instanceof TournamentError) return ephemeral(err.message)
        throw err
      }
    }

    case InteractionType.MESSAGE_COMPONENT: {
      const found = findButtonHandler(interaction.data?.custom_id)
      if (!found) return ephemeral('This button is no longer active.')
      try {
        return await found.handler.handle({ interaction, env, ctx }, found.parts)
      } catch (err) {
        if (err instanceof TournamentError) return ephemeral(err.message)
        throw err
      }
    }

    default:
      return ephemeral("Sorry, I can't handle that kind of interaction yet.")
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Visiting the Worker URL in a browser shows this, which is a handy way
    // to check that a deploy worked.
    if (request.method === 'GET') {
      return new Response('Yu-Gi-Oh tournament bot is running.', {
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      })
    }
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })

    const body = await request.text()
    const valid = await verifyDiscordSignature(
      env.DISCORD_PUBLIC_KEY ?? '',
      request.headers.get('x-signature-ed25519'),
      request.headers.get('x-signature-timestamp'),
      body
    )
    if (!valid) return new Response('Invalid request signature', { status: 401 })

    let interaction: Interaction
    try {
      interaction = JSON.parse(body)
    } catch {
      return new Response('Invalid JSON', { status: 400 })
    }

    try {
      return await handleInteraction(interaction, env, ctx)
    } catch (err) {
      console.error('Interaction failed', err)
      return ephemeral('Something went wrong on my side. Please try again, or ask an admin.')
    }
  }
} satisfies ExportedHandler<Env>
