# Yu-Gi-Oh Tournament Discord Bot

A Discord bot that runs an endless series of 8-player Yu-Gi-Oh tournaments.
It runs for free on Cloudflare Workers, with its data in Cloudflare D1.

**New here? Start with [SETUP.md](SETUP.md).**

## Development

```bash
npm install
npm test           # unit tests (vitest)
npm run typecheck  # TypeScript check
npm run deploy     # deploy to Cloudflare
npm run register   # register slash commands with your Discord server
```

```
src/
  index.ts         Worker entry: signature check, interaction routing
  discord/         Discord-specific helpers (verification, types, replies)
  logic/           Pure tournament rules, no Discord or database code:
                   bracket.ts (12-match bracket, results, recalculation),
                   draw.ts (random pairs), points.ts (points, rewards, standings)
  commands/        One file per slash command
  components/      Button handlers (Confirm/Dispute, Apply/Cancel)
  db/              Database queries (D1)
  services/        Steps that combine database and Discord (draw, announcements)
  views/           What the bot's messages look like
migrations/        D1 database schema (SQL), applied in order
scripts/
  register-commands.ts
test/              Tests. helpers/d1.ts runs the migrations on in-memory SQLite;
                   helpers/fakeDiscord.ts records every Discord API call
```
