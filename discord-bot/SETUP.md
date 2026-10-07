# Tournament bot: beginner guide

This guide takes you from nothing to a working bot on your Discord server,
and then explains how to run tournaments with it. Everything here is
**free**: the Cloudflare Workers free plan and Discord bots cost nothing,
and you don't need to enter a credit card.

- **Part 1: Setup** (once): steps 1 to 12.
- **Part 2: Running tournaments**: reporting, corrections, settings.
- **Part 3: Maintenance**: updating, backups, troubleshooting.

You'll type commands into a terminal. On Windows, open **Command Prompt**,
**Windows Terminal** or **PowerShell**. On Mac, open **Terminal**. Lines in
grey boxes are commands: type or paste them and press Enter.

> **How it works, in one paragraph.** When someone uses a slash command,
> Discord sends a web request to your bot's address on Cloudflare. Cloudflare
> runs the bot's code for a moment, the bot answers, and then it goes back to
> sleep. Nothing runs on your own computer, so your laptop can be off. All
> data lives in a small free database in your Cloudflare account.

> **How to use slash commands in Discord.** Type `/` and the start of the
> command, for example `/config`, then **pick it from the pop-up list**.
> Discord then shows a box for each option: click a box and fill it in or
> pick from its list. Press Enter to send. Don't type the whole line yourself:
> if there's no pop-up, Discord just sends your text as a normal message,
> which the bot can't see. In this guide, `/config channel channel:#tournament`
> is shorthand for "pick `/config channel`, then pick #tournament in the
> `channel` box".

---

# Part 1: Setup

## 1. Install the tools and create a Cloudflare account

1. Install **Node.js** (version 22 or newer). Download the "LTS" installer from
   <https://nodejs.org> and click through it with the default options.
   To check it worked, open a new terminal and run:
   ```
   node --version
   ```
   It should print something like `v22.x.x` or higher.
2. Get this project's code onto your computer. If you don't have the
   `yugioh-app` repository yet, install Git from <https://git-scm.com> and run:
   ```
   git clone https://github.com/endymion99-glitch/yugioh-app.git
   ```
   Until the bot is merged into the `main` branch, it lives on its own
   branch. Switch to it from inside the `yugioh-app` folder:
   ```
   git fetch origin
   git checkout claude/pensive-ptolemy-0jxavb
   ```
   A `discord-bot` folder should now appear.
3. Go into the bot's folder and install its tools. `wrangler`, Cloudflare's
   command-line tool, comes with them:
   ```
   cd yugioh-app/discord-bot
   npm install
   ```
   **Every command from here on is run inside this `discord-bot` folder.**
4. Create a free Cloudflare account at <https://dash.cloudflare.com/sign-up>
   and confirm your email address.
5. Log wrangler in to your account:
   ```
   npx wrangler login
   ```
   A browser window opens. Click **Allow**, then return to the terminal.

## 2. Create the database

The bot stores players, tournaments and results in **Cloudflare D1**, a free
database that lives in your Cloudflare account.

1. Create the database:
   ```
   npx wrangler d1 create yugioh-tournament
   ```
   It prints a few lines including `database_id = "..."`, a long ID that
   looks like `1a2b3c4d-....`. Copy that ID.
   - If wrangler asks *"Would you like Wrangler to add it on your behalf?"*,
     answer **No**. The project's settings file already has a place for it.
2. Open `wrangler.toml` (in the `discord-bot` folder) in a text editor. Find
   the `database_id = "..."` line near the bottom, replace the ID between
   the quotes with yours, and save the file.
   (This project's own database ID is already filled in. You only need to
   change it if you're setting up a separate copy of the bot.)
3. Create the tables inside the database:
   ```
   npx wrangler d1 migrations apply yugioh-tournament --remote
   ```
   Answer **yes** when asked. Each file in the `migrations` folder should be
   listed with a ✅. The `--remote` part means "the real database on
   Cloudflare", not a test copy on your computer.

## 3. Create the Discord application

1. Go to <https://discord.com/developers/applications> and log in with your
   Discord account.
2. Click **New Application** (top right), name it (for example
   "Tournament Bot"), accept the terms and click **Create**.
3. You're now on the **General Information** page. Copy these two values
   into a notepad for now:
   - **Application ID**
   - **Public Key**
4. In the left menu, click **Bot**. Under **Token**, click **Reset Token**,
   confirm, and copy the token into your notepad.
   - The token is a password for your bot. **Never share it or post it in
     Discord.** If it leaks, click Reset Token again to get a new one (and
     repeat step 4 below with the new one).
   - Discord only shows the token once. If you lose it, reset it again.
5. Still on the **Bot** page, leave the three "Privileged Gateway Intents"
   switched **off**. The bot doesn't need them.
6. *(Optional, recommended)* To stop strangers adding your bot to their own
   servers:
   1. Go to **Installation** in the left menu and set **Install Link** to
      **None**. Save.
   2. Go back to **Bot** and turn **Public Bot** off. Save.

## 4. Give the secrets to Cloudflare

The bot needs the three values from your notepad. Store them as Cloudflare
**secrets**, which keeps them encrypted and out of the code. Run each command
below. Each one asks you to paste a value: paste it and press Enter.

```
npx wrangler secret put DISCORD_APPLICATION_ID
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_BOT_TOKEN
```

The first time, wrangler may say there's no Worker called
`yugioh-tournament-bot` yet and ask whether to create it. Answer **yes**.

> Tip: when you paste into the terminal, nothing may appear on screen. That's
> normal for secrets. Just press Enter.

## 5. Deploy the bot

```
npm run deploy
```

If this is your first Worker, wrangler may ask you to pick a
`workers.dev` subdomain. Any name is fine, for example your username. The
output should list a binding called `DB` (the database from step 2).

When it finishes, it prints a web address like:

```
https://yugioh-tournament-bot.<your-subdomain>.workers.dev
```

Copy that address. Open it in your browser: you should see
**"Yu-Gi-Oh tournament bot is running."**

> **Getting `ERR_SSL_VERSION_OR_CIPHER_MISMATCH` or "can't provide a secure
> connection"?** That's normal right after you create a brand-new
> `workers.dev` subdomain. Cloudflare is still issuing its security
> certificate, which usually takes a few minutes and occasionally up to a
> day. Wait about 10 to 15 minutes and try again. Nothing is wrong with your
> setup. Don't do step 6 until the page loads, because Discord can't
> connect until the certificate is ready either.

## 6. Connect Discord to the bot

1. Back in the Discord Developer Portal, open your application and go to
   **General Information**.
2. Paste the Worker address from step 5 into **Interactions Endpoint URL**.
3. Click **Save Changes**.

Discord now sends a test request to your bot, and the bot must answer it
correctly. If you get an error saying the URL couldn't be verified, the
Public Key secret is usually wrong. Run
`npx wrangler secret put DISCORD_PUBLIC_KEY` again, paste the key carefully,
and try saving again.

## 7. Invite the bot to your server

Open this link in your browser, after replacing `YOUR_APPLICATION_ID` with
your Application ID:

```
https://discord.com/oauth2/authorize?client_id=YOUR_APPLICATION_ID&scope=bot+applications.commands&permissions=19456
```

Choose your server and click **Authorize**. You must be the server owner, or
have the **Manage Server** permission.

The `19456` gives the bot only the three permissions it needs: **View
Channels**, **Send Messages** and **Embed Links**. It mentions players and
the admin role through its own messages, so it doesn't need the broad
"Mention Everyone" permission.

## 8. Register the slash commands

1. Turn on Discord's **Developer Mode** so you can copy IDs: in Discord, open
   **User Settings** (gear icon) → **Advanced** → switch on **Developer Mode**.
2. Right-click your server's icon in the left sidebar → **Copy Server ID**.
3. In the `discord-bot` folder, make a copy of the file `.dev.vars.example`
   and name it `.dev.vars`. Open it in a text editor (Notepad is fine) and
   fill it in:
   ```
   DISCORD_APPLICATION_ID=your application id
   DISCORD_PUBLIC_KEY=your public key
   DISCORD_BOT_TOKEN=your bot token
   DISCORD_GUILD_ID=your server id
   ```
   This file stays on your computer. Git is set up to ignore it, so it never
   gets uploaded.
   > Windows tip: if Notepad saves it as `.dev.vars.txt`, choose
   > "Save as type: All files" when saving.
4. Register the commands:
   ```
   npm run register
   ```
   It should print `Registered 14 command(s): /ping, /config, ...`.

## 9. Test it

In any channel on your server, type `/ping` and pick the command from the
pop-up. The bot should reply (only you can see the reply) with
**"Pong! The tournament bot is online."**

## 10. Set up the admin role and the tournament channel

1. **Create the admin role.** In Discord, open **Server Settings** →
   **Roles** → **Create Role**. Name it **Tournament Admin**.
   - On the role's **Display** tab, turn on **Allow anyone to @mention this
     role**. The bot pings this role when a result is disputed, and it can
     only ping roles that allow it.
   - Save, then give the role to yourself (and any other admins): **Server
     Settings** → **Members** → click a member → **+** under Roles.
2. **Pick (or create) the tournament channel**, for example `#tournament`.
   If the channel is private, add the bot to it: open the channel's
   settings → **Permissions** → **Add members or roles** → pick the bot, and
   allow **View Channel**, **Send Messages** and **Embed Links**.
3. Run these two commands, one at a time (see "How to use slash commands"
   at the top):
   - `/config admin-role role:@Tournament Admin`
   - `/config channel channel:#tournament`

   Only someone with **Manage Server** (or Administrator, or the server
   owner) can run `/config admin-role`. After that, every admin command
   needs the Tournament Admin role.

   `/config channel` posts a short hello in the channel. If it says it
   couldn't post there, fix the channel permissions from point 2 and run it
   again.

The bot's replies to admin commands are private: only you see them.

## 11. Add the 8 players

For each of the 8 players, run:

```
/player add user:@TheirDiscordName name:TheirPlayerName
```

The name is what the bot shows in brackets and standings. After the 8th
player, the bot says the roster is complete. Check the roster with
`/player list`. These 8 players stay active for every future tournament.

## 12. Start the first tournament

Your first tournament was already drawn outside the bot, so enter its
pairings by hand:

1. Pick **`/tournament create-manual`**.
2. Fill in the 8 boxes: `m1_p1` and `m1_p2` are the two players of Round 1
   Match 1, `m2_p1` and `m2_p2` are Match 2, and so on. Pick the players
   exactly as they were drawn: the bracket depends on which match is which
   (the Match 1 and Match 2 winners meet in Winners' Semi A, the Match 3 and
   Match 4 winners in Winners' Semi B).
3. Press Enter. The bot creates **Tournament #1** and posts the pairings in
   the tournament channel. This post is **silent**: the players' names show
   as @mentions, but nobody gets a notification. To notify them, also set
   the optional `ping_players` box to `True`.

Then, for each match of Tournament #1 that has already been played, run
**`/result override`**:

- `match`: which match, e.g. *Round 1 · Match 1* or *Winners' Semi A*
- `winner`: the player who won
- `score`: only for Best of 3 matches (the Final, by default): *2-0* or *2-1*

Enter them in bracket order (Round 1 first, then the semis), because a semi
only exists once both of its Round 1 matches have a result. The "next match
is ready" posts that follow are **silent** by default. Add
`ping_players:True` to notify the players of the newly ready match.

**That's it: setup is done.** From now on the bot runs by itself.

---

# Part 2: Running tournaments

## The tournament format

8 players, 12 matches, 3 rounds, and every place from 1st to 8th decided:

- **Round 1:** 4 matches (M1 to M4).
- **Round 2:** Winners' Semi A (winners of M1 and M2), Winners' Semi B
  (winners of M3 and M4), Losers' Semi A (losers of M1 and M2) and Losers'
  Semi B (losers of M3 and M4).
- **Round 3:** the Final for 1st/2nd (the two Winners' Semi winners), and
  matches for 3rd/4th, 5th/6th and 7th/8th.

A match can be played as soon as both of its earlier matches are confirmed;
nobody has to wait for the whole round.

## How players report results

1. After playing, either player runs **`/report`**: `result` is *I won* or
   *I lost*, and `score` is only needed for Best of 3 (*2-0* or *2-1*). The
   bot finds their current match by itself.
2. The bot posts the claimed result in the tournament channel with
   **Confirm** and **Dispute** buttons and pings the opponent. Only the
   opponent (or an admin) can press them.
3. **Confirm** makes it final. As soon as both matches feeding a later match
   are confirmed, the bot posts "A new match is ready!" and tags both
   players.
4. **Dispute** pings the Tournament Admin role. An admin settles it with
   `/result override`; the report message then shows "Settled by an admin".

If a player reports by mistake, either player can simply `/report` again
before it's confirmed: the new report replaces the old one.

## Commands for everyone

| Command | What it shows |
|---|---|
| `/mymatch` | Your current match and opponent, and what to do next (private) |
| `/report` | Report your match result (see above) |
| `/bracket` | All 12 matches of the current tournament and their status. Add `tournament:<number>` for an older one |
| `/standings` | The overall leaderboard: points, place counts (🥇×2 …) and tournaments played |
| `/history` | Finished tournaments with their podium, 10 per page (`page:2` for more). `/history tournament:<number>` opens one in detail |
| `/stats` | A player's points and rank, tournaments played, best and average place, match and game record, placement counts, and head-to-head against everyone they've played. `/stats player:@someone` for someone else |

These replies never ping anyone. All of them are visible to the channel
except `/mymatch`, which only you can see.

## When a tournament ends

As soon as the 12th match is confirmed, the bot:

1. works out places 1st to 8th and awards the points,
2. posts the **summary** in the tournament channel: every player's place,
   points earned, rewards (the 10 packs everyone gets plus their placement
   reward, with the total packs), and their overall points and rank, plus
   the results of the four placement matches,
3. **immediately draws the next tournament** with the reveal (about 12
   seconds, one match at a time) and tags everyone. No admin action needed,
   forever.

If the next tournament can't start (for example, there aren't exactly 8
active players), the bot says so in the channel; fix it and run `/draw`.

## Admin commands

| Command | What it does |
|---|---|
| `/config admin-role` | Which role counts as Tournament Admin |
| `/config channel` | Where the bot posts |
| `/config format` | Best of 1 or 3 for a stage (see below) |
| `/player add` / `swap` / `remove` / `list` | Manage the roster (see below) |
| `/draw` | Start a tournament with a random draw, when none is running |
| `/tournament create-manual` | Start a tournament from pairings you choose |
| `/result override` | Set or correct any result (see below) |
| `/points set` | Points for a place |
| `/rewards set` | Rewards for a place |

### Correcting results

Admins can change any result at any time with `/result override`, also for
past tournaments (fill in the `tournament` number).

- Changing only the score, or the winner of a placement match, applies
  straight away.
- If the change means different players should have played later matches
  that already have results, the bot first shows how many matches will be
  reset (and which) with **Apply** and **Cancel** buttons. Applying clears
  those matches so they can be played, or entered, again.
- Correcting a finished tournament posts a **Correction** message with its
  updated summary (and updated totals). No new tournament is drawn.
- If the correction clears later matches, the tournament is reopened for
  admins: enter the cleared matches with
  `/result override tournament:<number>`. Players can't `/report` in it.
  The Correction is posted once all 12 matches have results again.

### Changing players

- `/player swap old:@Leaving new:@Joining name:NewName` replaces a player.
  This also works in the middle of a tournament: the new player takes over
  the matches the old player hasn't played yet (and is tagged for any that
  can be played now). Results already played stay with the old player, and
  the new player's stats start fresh.
- `/player remove user:@Someone` removes a player between tournaments. It's
  refused while they're in a tournament; use swap instead. Their history is
  kept either way.

### Match formats

By default every match is Best of 1, except the Final (1st/2nd), which is
Best of 3. To change a stage for future tournaments:

```
/config format stage:3rd/4th Place Match best_of:Best of 3
```

Add `apply_to_current:True` to also change that stage's matches in the
current tournament that don't have a result yet.

### Points and rewards

Defaults: points 10, 8, 7, 6, 5, 4, 3, 1 for places 1 to 8. Rewards: 10
packs for everyone, plus 4/3/2/1 cards of their choice for 1st to 4th and
4/6/8/10 extra packs for 5th to 8th.

- `/points set place:1 points:12` changes the points for a place. Totals are
  always calculated from the current table, so this updates everyone's
  totals for all past tournaments too.
- `/rewards set place:5 extra_packs:5` changes a reward. Leave a box empty to
  keep its current value. Boxes: `base_packs`, `extra_packs`,
  `chosen_cards`.

### `/draw`

Normally you won't need it: once a tournament finishes, the bot draws the
next one automatically. When no tournament is running, `/draw` shuffles the
8 players into 4 random pairs and reveals them in the tournament channel.

- If you run it anywhere else, the reveal still goes to the tournament
  channel and you get a private note.
- If the bot can't post in the tournament channel, it tells you, and no
  tournament is created, so you can fix it and try again.
- If the tournament in progress already has all 12 results (for example, it
  finished while the bot was being updated), `/draw` posts its summary first
  and then draws the next one.

---

# Part 3: Maintenance

## Updating the bot

Whenever there's a new version of the code, run these in the `discord-bot`
folder:

```
git pull
npm install
npx wrangler d1 migrations apply yugioh-tournament --remote
npm run deploy
npm run register
```

- The migrations command only does something when a new version changes the
  database. Otherwise it says there's nothing to apply, which is fine.
- `npm run register` is only needed when commands change, but it never hurts.
- If `git pull` refuses because of "local changes" to a file you didn't mean
  to change (often `wrangler.toml`), run `git checkout <that file>` and pull
  again.

Tournaments, players and results are kept across updates: they're in the
database, not in the code.

## Backing up your data

To save a copy of everything in the database (players, all tournaments and
results) to a file on your computer:

```
npx wrangler d1 export yugioh-tournament --remote --output backup.sql
```

Keep `backup.sql` somewhere safe. It's a plain text file of SQL commands
that can recreate the data. Doing this once in a while (say, monthly) is
plenty.

### Restoring a backup

Only needed if the database is lost or broken. Restore into a **new, empty**
database:

1. `npx wrangler d1 create yugioh-tournament-restored` and put the new
   `database_id` and `database_name` into `wrangler.toml` (and use the new
   name in the commands below).
2. `npx wrangler d1 execute yugioh-tournament-restored --remote --file backup.sql`
   (the backup already contains the tables, so don't run the migrations
   first).
3. `npm run deploy`.

## Troubleshooting

| Problem | What to do |
|---|---|
| A command doesn't appear in the `/` pop-up | Run `npm run register`, then press Ctrl+R (Cmd+R on Mac) in Discord |
| "The application did not respond" | Check the Interactions Endpoint URL (step 6) is saved and the Worker address opens in a browser. Then look at the logs (below) |
| "Something went wrong on my side" | Usually the database: run the migrations command from "Updating the bot". Then look at the logs |
| The bot can't post in the channel | Give the bot View Channel, Send Messages and Embed Links in that channel (step 10), then run `/config channel` again |
| Admin pings don't notify anyone | Turn on "Allow anyone to @mention this role" for the admin role (step 10) |
| "Only members with the … role" | Give yourself the Tournament Admin role, or check `/config admin-role` |
| A draw needs exactly 8 active players | Check `/player list`, then `/player add` or `/player swap` |

### Seeing the bot's logs

To watch what the bot is doing (and any errors) live:

```
npx wrangler tail
```

Leave it running, use a command in Discord, and the log lines appear in the
terminal. Press Ctrl+C to stop. You can also see logs in the Cloudflare
dashboard: **Workers & Pages** → `yugioh-tournament-bot` → **Logs**.

## Staying free

The bot uses the Cloudflare Workers and D1 free plans. A group of friends
uses a tiny fraction of their daily limits (100,000 requests and millions of
database reads per day), and the bot never runs on a timer, so nothing is
used when nobody is playing. If Cloudflare ever asks you to upgrade, you
don't need to.
