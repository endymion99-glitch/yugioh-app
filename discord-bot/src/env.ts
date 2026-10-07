// Values the Worker receives from Cloudflare. The DISCORD_* values are
// secrets set with `npx wrangler secret put <NAME>` (see SETUP.md).
export interface Env {
  DISCORD_PUBLIC_KEY: string
  DISCORD_APPLICATION_ID: string
  DISCORD_BOT_TOKEN: string
}
