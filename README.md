# Kova

Discord bot I made with Node.js and discord.js. It started as a small bot to send embeds and schedule messages, then I kept adding stuff and it turned into an all-in-one bot (moderation, economy, levels, music, tickets, etc). It also has a web panel so you can manage it from the browser.

## Features

**Moderation**
- `/warn`, `/warnings`, `/clearwarnings` (10 warnings = automatic jail)
- Jail system with `!jail @user [time]` and `!unjail`, the roles get given back after
- Automod for spam, links, banned words and caps (`/automod`)
- Mod logs, deleted message logs, `!snipe` and `!esnipe`
- `/purge` to delete a bunch of messages

**Community**
- Levels and XP with a leaderboard and role rewards
- Tickets with `!ticket` (saves a transcript when it's closed)
- Reaction roles, welcome/leave messages, starboard, confessions
- Temp voice channels (join to create)
- Polls, giveaways, reminders and AFK

**Economy**
- bank, daily, work, jobs, quests, shop and inventory
- games like coinflip, slots, blackjack and rob
- `!eco` shows all the economy commands

**Music**
- plays from YouTube and SoundCloud (search or link)
- Spotify links work too if you add Spotify keys
- queue, skip, pause, loop, shuffle, volume

**Messages**
- `/send` to send embeds and `/message` to save them as templates
- `/schedule` for messages that repeat (every X minutes, daily or weekly)
- custom commands that you can make from the web panel

There's also a bunch of fun and utility commands, `!help` shows everything.

## Web panel

It starts on port 3000 with the bot. On the panel you can:
- make an account (email verification is optional) and link your Discord
- send messages and manage the scheduled ones
- manage templates and custom commands
- see server stats (member growth, messages per day, peak hours, top commands)
- warn or jail people and check the mod log
- see the economy and levels leaderboards

Admins (set with `ADMIN_DISCORD_IDS`) can see everything, normal users only see their own schedules.

## Made with

- Node.js and discord.js v14
- Express for the web panel and the API
- SQLite (better-sqlite3) to save the data
- yt-dlp and ffmpeg for the music
- HTML, CSS and JavaScript for the panel
- Railway for hosting

## Run it

You need Node.js 20 or newer. For music you also need ffmpeg and yt-dlp installed.

```bash
git clone https://github.com/zek1els/DiscordBot.git
cd DiscordBot
npm install
cp .env.example .env
npm start
```

Create a bot in the [Discord Developer Portal](https://discord.com/developers/applications) and turn on the 3 privileged intents (Presence, Server Members and Message Content). Put the token in `.env` as `DISCORD_TOKEN`. The slash commands register by themselves when the bot starts.

To invite the bot, set `DISCORD_CLIENT_ID` and go to `/invite` on the panel.

## .env

Only `DISCORD_TOKEN` is required, the rest is optional:

- `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` and `PUBLIC_URL`: Discord login on the panel. The redirect URL to add in the portal is `PUBLIC_URL/api/auth/discord/callback`
- `ADMIN_DISCORD_IDS`: Discord IDs of the panel admins, separated by commas
- `API_KEY`: to use the API from a script without logging in
- `PORT` (3000 by default) and `DATA_DIR` (./data by default)
- `RESEND_API_KEY` and `RESEND_FROM`, or the `SMTP_` variables: email verification
- `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`: Spotify links
- `WEB_ONLY=true`: only runs the web panel, not the bot

There's more detail in SETUP.txt.

## Railway

`nixpacks.toml` already installs ffmpeg and yt-dlp. Add the variables from your `.env`, add a volume on `/data` so the database doesn't get wiped when you redeploy, and set `PUBLIC_URL` to your Railway domain. The steps are in RAILWAY.md.
