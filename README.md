# Discord Custom Message Bot

A Discord bot for **rich embed messages** and **scheduled posts**, inspired by [embed-generator](https://github.com/merlinfuchs/embed-generator) / [message.style](https://message.style).

## Features

- **`/send`** — Send a **rich embed** to a channel: title, description, color, URL, author (name + icon), footer (text + icon), thumbnail, large image, timestamp, and up to 3 inline fields.
- **`/message save`** — Save a message as a **template** by name (same rich options as `/send`).
- **`/message send`** — Send a saved template to a channel.
- **`/message list`** — List saved template names.
- **`/message delete`** — Delete a saved template.
- **`/schedule create`** — Schedule recurring messages (every N minutes, daily at a time, or weekly). Use inline content/embed or a **saved message** template.
- **`/schedule list`** and **`/schedule delete`** — Manage scheduled jobs.

Data is stored in `data/` (schedules and saved messages) and survives restarts.

### Web app (send & schedule outside Discord)

When the bot is running, a **local web app** is available so you can send and schedule messages from your browser (no Discord needed for that). Fully **free** — runs on your machine.

1. Start the bot (`npm start`).
2. Open **http://localhost:3000** in your browser.
3. Optionally set `API_KEY` in `.env` if you want to protect the API (e.g. when port is exposed). If you don’t set it, the API only accepts requests from localhost.

From the web UI you can: pick server & channel, type a message, **Send now**, or **Create schedule**. Time and timezone use dropdowns (e.g. Europe/Athens). You can list and delete scheduled messages.

**Deploy on Railway (free):** See **[RAILWAY.md](RAILWAY.md)** for step-by-step instructions. The panel uses **Login with Discord** only. Set **ADMIN_DISCORD_IDS** (your Discord user ID) so you see all scheduled messages; others see only the ones they created.

**Where to find Client ID and Secret:** [Discord Developer Portal](https://discord.com/developers/applications) → your app. **Client ID** = **Application ID** on the app’s front page. **Client Secret** = **OAuth2** (left sidebar) → **Client Secret** (click **Reset** to reveal). In **OAuth2 → Redirects**, add `https://YOUR_PUBLIC_URL/api/auth/discord/callback`.

## Setup

1. **Create a bot** at [Discord Developer Portal](https://discord.com/developers/applications) → New Application → Bot. Copy the token.

2. **Invite the bot** to your server with at least:
   - `applications.commands`
   - `Send Messages`
   - `Embed Links`

3. **Configure**:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and set `DISCORD_TOKEN=your_bot_token`.

4. **Run**:
   ```bash
   npm start
   ```

5. In Discord, use **`/send`** for one-off messages or **`/schedule create`** for recurring ones.

## Commands

### `/send`

Send a rich embed (similar to [message.style](https://message.style)):

| Option            | Description |
|-------------------|-------------|
| `channel`         | Channel to send to (required) |
| `content`          | Main message text |
| `embed_title`     | Embed title |
| `embed_description` | Embed description |
| `embed_color`     | Hex color (e.g. #FF5733) |
| `embed_url`       | Clickable title URL |
| `author_name`     | Author name |
| `author_icon_url` | Author icon image URL |
| `footer_text`     | Footer text |
| `footer_icon_url` | Footer icon URL |
| `thumbnail_url`   | Thumbnail image URL |
| `image_url`       | Large image URL |
| `timestamp`       | Show current time in embed |
| `field1_name` / `field1_value` … `field3` | Up to 3 inline fields |

At least one of content or any embed field must be set.

### `/message`

- **save** — Save a template by `name` (same options as `/send`). Use **send** to post it to a channel, or **schedule create** with `saved_message` to reuse it.
- **send** — Send a saved template to a `channel` by `name`.
- **list** — List saved template names.
- **delete** — Delete a template by `name`.

### `/schedule create`

| Option          | Description |
|-----------------|-------------|
| `channel`       | Channel (required) |
| `schedule_type` | Every N minutes / Daily at a time / Weekly |
| `saved_message` | Use a saved template (optional; otherwise set content/embed below) |
| `content`, `embed_title`, `embed_description`, `embed_color` | Inline message (if not using `saved_message`) |
| `minutes`       | For “Every N minutes”: 1–60 |
| `time`          | For daily/weekly: `HH:MM` (24h) |
| `day_of_week`   | For weekly: 0=Sun … 7=Sun |
| `timezone`       | e.g. `America/New_York` |

### `/schedule list` and `/schedule delete`

List scheduled messages (with IDs) or remove one by ID.
