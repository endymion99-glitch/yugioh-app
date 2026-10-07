// Values the Worker receives from Cloudflare. The DISCORD_* values are
// secrets set with `npx wrangler secret put <NAME>` (see SETUP.md).
export interface Env {
  /** The D1 database, configured in wrangler.toml. */
  DB: D1Database
  DISCORD_PUBLIC_KEY: string
  DISCORD_APPLICATION_ID: string
  DISCORD_BOT_TOKEN: string
  /** Pause between steps of the draw reveal, in milliseconds. Tests set it to 0. */
  REVEAL_DELAY_MS?: string
}
