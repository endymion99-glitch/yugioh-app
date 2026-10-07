# Setting up the tournament bot (beginner guide)

This guide takes you from nothing to a working bot on your Discord server.
Everything here is **free**: the Cloudflare Workers free plan and Discord
bots cost nothing, and you don't need to enter a credit card.

You'll type commands into a terminal. On Windows, open **Windows Terminal**
or **PowerShell**. On Mac, open **Terminal**. Lines in grey boxes are commands:
type or paste them and press Enter.

> **How it works, in one paragraph.** When someone uses a slash command,
> Discord sends a web request to your bot's address on Cloudflare. Cloudflare
> runs the bot's code for a moment, the bot answers, and then it goes back to
> sleep. Nothing runs on your own computer, so your laptop can be off.

---

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
   The bot is being built on its own branch, which is a separate line of
   work, until it gets merged into `main`. Switch to it from inside the
   `yugioh-app` folder:
   ```
   git fetch origin
   git checkout claude/pensive-ptolemy-0jxavb
   ```
   A `discord-bot` folder should now appear. Later, run `git pull` to get
   new versions.
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
   Answer **yes** when asked. You should see `0001_initial.sql` with a ✅.
   The `--remote` part means "the real database on Cloudflare", not a test
   copy on your computer.
4. Deploy again so the bot is connected to the database:
   ```
   npm run deploy
   ```
   The output should now list a binding called `DB`.

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
     Discord.** If it leaks, click Reset Token again to get a new one.
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
`workers.dev` subdomain. Any name is fine, for example your username.

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
   It should print `Registered N command(s): ...` with the list of commands.

**Run `npm run register` again whenever a new version of the bot adds
commands.**

## 9. Test it

In any channel on your server, type `/ping` and pick the command from the
pop-up. The bot should reply (only you can see the reply) with
**"Pong! The tournament bot is online."**

If `/ping` doesn't appear at all, run `npm run register` again and restart
Discord with Ctrl+R (Cmd+R on Mac). If it appears but says "The application
did not respond", check that the Interactions Endpoint URL from step 6 is
saved.

---

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
3. In any channel, run:
   ```
   /config admin-role role:@Tournament Admin
   /config channel channel:#tournament
   ```
   Only someone with **Manage Server** (or Administrator, or the server
   owner) can run `/config admin-role`. After that, every admin command
   needs the Tournament Admin role.

The bot's replies to admin commands are private: only you see them.

## 11. Add the 8 players

For each of the 8 players, run:

```
/player add user:@TheirDiscordName name:TheirPlayerName
```

The name is what the bot shows in brackets and standings. After the 8th
player, the bot says the roster is complete. Check the roster with
`/player list`.

These 8 players stay active for every future tournament. If you ever need to
change someone:

- `/player swap old:@Leaving new:@Joining name:NewName` replaces a player.
  This also works in the middle of a tournament: the new player takes over
  the matches the old player hasn't played yet. Results already played stay
  with the old player, and the new player's stats start fresh.
- `/player remove user:@Someone` removes a player between tournaments. It's
  refused while they're in a tournament; use swap instead. Their history is
  kept either way.

## Changing match formats

By default every match is Best of 1, except the Final (1st/2nd), which is
Best of 3. To change a stage for future tournaments:

```
/config format stage:3rd/4th Place Match best_of:Best of 3
```

Add `apply_to_current:True` to also change that stage's matches in the
current tournament that don't have a result yet.

*More steps (the first tournament) will be added here as those features
are built.*

## Redeploying after changes

Whenever you get a new version of the code (for example with `git pull`):

```
npm install
npx wrangler d1 migrations apply yugioh-tournament --remote
npm run deploy
npm run register
```

The migrations command only does something when a new version adds
database changes. Otherwise it says there's nothing to apply, which is fine.

## Backing up your data

To save a copy of everything in the database (players, all tournaments and
results) to a file on your computer:

```
npx wrangler d1 export yugioh-tournament --remote --output backup.sql
```

Keep `backup.sql` somewhere safe. It's a plain text file of SQL commands
that can recreate the data.
