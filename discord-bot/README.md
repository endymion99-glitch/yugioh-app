# Yu-Gi-Oh Tournament Discord Bot

A Discord bot that runs an endless series of 8-player Yu-Gi-Oh tournaments
for a group of friends. It draws the pairings (with a reveal animation),
tracks the bracket, collects results with Confirm/Dispute buttons, awards
points and rewards, keeps the cumulative standings, and starts the next
tournament as soon as one finishes.

It runs **for free** on Cloudflare Workers with a Cloudflare D1 database, and
is always on without any computer of yours running.

**Setting it up or running tournaments? Read [SETUP.md](SETUP.md).** It's a
step-by-step guide for beginners, including updating, backups and
troubleshooting.

## Features

- **Format:** 8 players, 12 matches over 3 rounds deciding every place 1st to
  8th (Round 1; winners' and losers' semis; matches for 1st/2nd, 3rd/4th,
  5th/6th and 7th/8th). A match opens as soon as both of its earlier matches
  are confirmed.
- **Best of 1 / Best of 3 per stage** (default: Bo1, and Bo3 for the Final),
  editable without code changes, and per match in the current tournament.
- **Random draw** with a step-by-step reveal, or manual pairings for a
  tournament drawn elsewhere.
- **Player-reported results** with Confirm/Dispute buttons only the opponent
  (or an admin) can press; disputes ping the admin role.
- **Admin overrides** for any result, current or past. Later matches that
  depend on a changed result are reset after a confirmation step; corrected
  finished tournaments get a "Correction" summary.
- **Summary** after every tournament: placings, points, rewards (packs and
  cards of choice), cumulative totals and ranks, then an automatic new draw.
- **Editable points and rewards tables**; cumulative points are always
  derived from placements and the current table.
- **Standings** with tiebreaks (most 1st places, then 2nd, ...; still tied =
  shared rank), **history**, **bracket**, **my match** and **player stats**
  with head-to-head records.
- **Mid-tournament swaps**: a replacement takes over the unplayed matches;
  results stay with whoever played them.

## Commands

| Everyone | |
|---|---|
| `/report` | Report your match result |
| `/mymatch` | Your current match and opponent |
| `/bracket` | The bracket and status of every match |
| `/standings` | Cumulative leaderboard |
| `/history` | Past tournaments; one in detail |
| `/stats` | A player's stats and head-to-head |
| `/ping` | Check the bot is online |

| Admins (Tournament Admin role) | |
|---|---|
| `/config admin-role` / `channel` / `format` | Settings |
| `/player add` / `swap` / `remove` / `list` | Roster |
| `/draw` | Random draw with reveal |
| `/tournament create-manual` | Tournament from given pairings |
| `/result override` | Set or correct any result |
| `/points set`, `/rewards set` | Points and rewards tables |

## How it works

Discord sends every slash command and button click to the Worker as an HTTPS
request (the "Interactions Endpoint" model, so there is no always-open
connection to keep alive). The Worker verifies Discord's Ed25519 signature
with Web Crypto, answers within Discord's 3-second limit, and uses
`ctx.waitUntil` for slower follow-ups such as the draw reveal (about 12.5 s of
timed message edits). Messages in the tournament channel are sent through
Discord's REST API with the bot token. Every message sets `allowed_mentions`
so it only pings the people or role it means to.

The tournament rules are pure functions with no Discord or database code
(`src/logic/`), which keeps them easy to test.

## Development

Requires Node.js 22+.

```bash
npm install
npm test           # all tests (vitest)
npm run typecheck  # TypeScript check
npm run deploy     # deploy to Cloudflare
npm run register   # register slash commands with your Discord server
npx wrangler tail  # live logs of the deployed bot
```

The tests run every command end to end against an in-memory SQLite copy of
the real migrations, with a fake Discord that records every API call, so
they need no accounts or network.

```
src/
  index.ts         Worker entry: signature check, routing, error handling
  logic/           Pure tournament rules, no Discord or database code:
                   bracket.ts (12-match bracket, results, recalculation),
                   draw.ts (random pairs), points.ts (points, rewards,
                   standings), stats.ts (player stats, head-to-head)
  commands/        One file per slash command
  components/      Button handlers (Confirm/Dispute, Apply/Cancel)
  services/        Steps that combine database and Discord (draw and reveal,
                   saving results, announcements, finishing a tournament)
  views/           What the bot's messages look like
  db/              Database queries (D1)
  discord/         Discord helpers (verification, REST API, replies, types)
migrations/        D1 database schema (SQL), applied in order
scripts/
  register-commands.ts
test/              Tests. helpers/d1.ts runs the migrations on in-memory
                   SQLite; helpers/fakeDiscord.ts records Discord API calls
```

### Data model

`config` (admin role, channel), `stage_formats`, `players`, `tournaments`,
`matches` (12 per tournament; `best_of` is copied from `stage_formats` when
created; a pending report and its message id live on the match),
`placements`, `points_table`, `rewards_table`, and `substitutions`
(mid-tournament swaps). Totals are never stored: they are computed from
`placements` and `points_table`, so corrections and table edits stay
consistent.

### Updating and backups

See "Part 3: Maintenance" in [SETUP.md](SETUP.md): `git pull`, apply
migrations, `npm run deploy`, `npm run register`; back up with
`npx wrangler d1 export yugioh-tournament --remote --output backup.sql`.
