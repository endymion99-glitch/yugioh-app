// Registers (or updates) every slash command with Discord for your server.
//
//   npm run register
//
// It reads DISCORD_APPLICATION_ID, DISCORD_BOT_TOKEN and DISCORD_GUILD_ID
// from the .dev.vars file in this folder (or from environment variables).
// Commands are registered for one server ("guild"), so changes show up
// instantly. Run it again whenever the list of commands changes.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { commands } from '../src/commands/registry'

function loadDevVars(): Record<string, string> {
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', '.dev.vars')
  if (!existsSync(path)) return {}
  const vars: Record<string, string> = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (match) vars[match[1]] = match[2].replace(/^["']|["']$/g, '')
  }
  return vars
}

const fileVars = loadDevVars()
const get = (name: string): string => {
  const value = process.env[name] || fileVars[name]
  if (!value) {
    console.error(`Missing ${name}. Add it to discord-bot/.dev.vars (see SETUP.md, step 8).`)
    process.exit(1)
  }
  return value
}

const appId = get('DISCORD_APPLICATION_ID')
const token = get('DISCORD_BOT_TOKEN')
const guildId = get('DISCORD_GUILD_ID')

const res = await fetch(`https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`, {
  method: 'PUT',
  headers: { authorization: `Bot ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify(commands.map((c) => c.definition))
})

if (!res.ok) {
  console.error(`Discord rejected the commands (HTTP ${res.status}):`)
  console.error(await res.text())
  process.exit(1)
}

const registered = (await res.json()) as Array<{ name: string }>
console.log(`Registered ${registered.length} command(s): ${registered.map((c) => '/' + c.name).join(', ')}`)
