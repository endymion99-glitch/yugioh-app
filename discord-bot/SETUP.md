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

*(This step will be added in build step 2. Skip it for now.)*

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
   It should print `Registered 1 command(s): /ping`.

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

*More steps (admin role, channel, players, first tournament) will be added
here as those features are built.*

## Redeploying after changes

Whenever you get a new version of the code (for example with `git pull`):

```
npm install
npm run deploy
npm run register
```
