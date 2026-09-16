# Kova

An all-in-one Discord bot: moderation, levels, economy, music, tickets and scheduled messages. It comes with a web dashboard, so server staff can manage everything from the browser.

**Built with:** Node.js · discord.js v14 · Express 5 · SQLite (better-sqlite3) · vanilla JS dashboard · deployed on Railway

---

## Features

### Moderation
- **Warnings**: `/warn`, `/warnings`, `/clearwarnings`. A member who reaches 10 warnings is jailed automatically.
- **Jail system**: `!jail @user [time]` and `!unjail` for temporary or permanent jails. The member's roles are saved and given back on release (`/jail-setup` first).
- **Auto-moderation** (`/automod`): spam, link, blacklisted-word and excessive-caps filters. Each filter can delete, warn, mute or kick.
- **Logging**: mod action log (`/modlog-setup`), deleted-message log (`/log-deletes`), `!snipe` / `!esnipe`
- **Cleanup**: `/purge` to bulk-delete messages

### Community
- **Levels & XP**: members earn XP by chatting and voice time is tracked. Includes `/level`, `/leaderboard` (XP, messages, voice) and role rewards at set levels (`/levels role-reward`).
- **Support tickets**: `!ticket` opens a private channel. Transcripts are saved to a log channel on close (`/ticket-setup`).
- **Reaction roles**, **welcome / leave messages**, **starboard**, **anonymous confessions**
- **Join-to-Create voice channels**: members can rename, limit, lock and unlock their own channel (`/tempvoice`)
- **Polls**, **giveaways**, **reminders** and **AFK status**

### Economy
- Wallet and bank, daily rewards, jobs, work and quests
- Shop, inventory and a server leaderboard
- Games: coinflip, slots, blackjack, rob
- `!eco` lists every economy command

### Music
- Play from a YouTube search, or from YouTube and SoundCloud links
- Spotify links are matched to YouTube (optional credentials)
- Queue, skip, pause/resume, loop (song or queue), shuffle and volume

### Messages & scheduling
- `/send`: rich embeds with title, colour, author, footer, images and fields
- `/message`: save embeds as reusable templates
- `/schedule`: recurring posts every N minutes, daily or weekly, time-zone aware
- Custom `!commands` created from the dashboard

### Fun & utility
`!8ball`, `!dice`, `!rps`, `!choose`, `!ship`, `!roast`, `!ping`, `!uptime`, `!avatar`, `!serverinfo`, `!userinfo`, `!roleinfo` and more. Type **`!help`** in Discord for the full list; most commands have short aliases.

---

## Web dashboard

The bot serves its own dashboard (default: `http://localhost:3000`).

- **Accounts**: email and password sign-up (passwords hashed with scrypt), optional email verification, Discord account linking through OAuth2
- **Messaging**: send messages and create or edit scheduled posts without opening Discord
- **Content**: manage saved templates and custom commands
- **Analytics**: member growth, messages per day, peak activity hours, most-used commands
- **Moderation**: warn, jail and unjail members, browse recent warnings, search the mod log
- **Leaderboards**: economy and level rankings
- **Admin tools**: registered users and server configuration. Admins are set with `ADMIN_DISCORD_IDS` and see every schedule; other users see only their own.

---

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20+ (ES modules) |
| Discord | discord.js v14, @discordjs/voice |
| Web server & API | Express 5 (REST API, cookie sessions, Discord OAuth2) |
| Database | SQLite through better-sqlite3 (WAL mode) |
| Scheduling | node-cron, cron-parser |
| Music | yt-dlp, play-dl, ffmpeg |
| Email | Resend API or SMTP (nodemailer) |
| Frontend | HTML, CSS, vanilla JavaScript |
| Hosting | Railway (Nixpacks) |

## Project structure

```
src/
├── index.js              # Entry point: Discord client, slash command registration, web server
├── commands.js           # Slash command definitions
├── api.js                # Express app and REST API
├── routes/               # Auth, admin and schedule routes
├── handlers/             # Interaction, message, voice and deleted-message event handlers
├── storage.js            # Shared SQLite connection
└── *.js                  # One module per feature (economy, levels, music, tickets, automod…)
public/                   # Web dashboard (index.html, app.js, styles.css)
```

---

## Getting started

### Prerequisites
- Node.js 20 or newer
- A Discord application with a bot user ([Developer Portal](https://discord.com/developers/applications))
- For music: `ffmpeg` and `yt-dlp` installed and on your PATH

### 1. Install
```bash
git clone https://github.com/zek1els/DiscordBot.git
cd DiscordBot
npm install
```

### 2. Set up the Discord application
1. In the Developer Portal, go to **Bot**, reset the token and copy it.
2. Under **Privileged Gateway Intents**, enable **Presence**, **Server Members** and **Message Content**.
3. For the dashboard's Discord login: go to **OAuth2 → Redirects** and add `https://YOUR_PUBLIC_URL/api/auth/discord/callback`.

### 3. Configure
```bash
cp .env.example .env
```
Only `DISCORD_TOKEN` is required. All other variables are listed below.

### 4. Run
```bash
npm start
```
Slash commands are registered automatically in every server the bot is in. The dashboard starts on port 3000.

### 5. Invite the bot
With `DISCORD_CLIENT_ID` set, open `/invite` on the dashboard to get an invite link with the needed permissions.

---

## Configuration

| Variable | Required | Description |
|---|---|---|
| `DISCORD_TOKEN` | **Yes** | Bot token |
| `DISCORD_CLIENT_ID` | For dashboard | Application ID (OAuth2 login and invite link) |
| `DISCORD_CLIENT_SECRET` | For dashboard | OAuth2 client secret |
| `PUBLIC_URL` | For dashboard | Public URL of the dashboard, no trailing slash |
| `ADMIN_DISCORD_IDS` | No | Comma-separated Discord user IDs with admin access |
| `API_KEY` | No | Key for programmatic API access |
| `PORT` | No | Dashboard port (default `3000`) |
| `DATA_DIR` | No | Where the SQLite database is stored (default `./data`) |
| `RESEND_API_KEY`, `RESEND_FROM` | No | Email verification through Resend |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | No | Email verification through SMTP |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | No | Enables Spotify links in music |
| `WEB_ONLY` | No | Set to `true` to run only the dashboard, without the bot |

If no email provider is configured, dashboard accounts are created without verification.

---

## Deployment (Railway)

The included `nixpacks.toml` installs Node.js 22, ffmpeg and yt-dlp.

1. Create a Railway project from this repository.
2. Add the environment variables above.
3. Add a **Volume** mounted at `/data` and set `DATA_DIR=/data` so the database survives redeploys.
4. Generate a public domain, set it as `PUBLIC_URL`, and add the matching OAuth2 redirect in the Discord Developer Portal.

For more detail, see [`RAILWAY.md`](RAILWAY.md) and [`SETUP.txt`](SETUP.txt).
