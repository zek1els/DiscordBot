# Deploy on Railway

Steps to run your Discord bot and web app on [Railway](https://railway.app) for free.

## 1. Push your code to GitHub

If you haven’t already:

```bash
git init
git add .
git commit -m "Initial commit"
# Create a repo on GitHub, then:
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

## 2. Create a Railway project

1. Go to [railway.app](https://railway.app) and sign in (e.g. with GitHub).
2. Click **New Project** → **Deploy from GitHub repo**.
3. Choose your Discord bot repository and deploy. Railway will detect Node and run `npm install` and `npm start`.

## 3. Set environment variables

In your Railway project: **Your Service** → **Variables** → **Add Variable**. Add:

| Variable        | Value                    | Required |
|----------------|--------------------------|----------|
| `DISCORD_TOKEN`| Your bot token from the [Discord Developer Portal](https://discord.com/developers/applications) → Bot → Reset/Copy | **Yes** |
| `ADMIN_PASSWORD`  | Password to log into the web app (use this and/or Discord login) | Recommended |
| `PUBLIC_URL`      | Your app’s public URL (e.g. `https://your-app.up.railway.app`) – required for Discord login | If using Discord login |
| `DISCORD_CLIENT_ID` | Same as your bot’s Application ID in the Discord Developer Portal | If using Discord login |
| `DISCORD_CLIENT_SECRET` | From Discord Developer Portal → OAuth2 → Client Secret | If using Discord login |
| `ALLOWED_DISCORD_IDS` | Optional: comma-separated Discord user IDs that can log in (if empty, any Discord user can) | No |
| `API_KEY`         | Optional: for script/programmatic API access        | No |
| `GUILD_ID`        | Your Discord server ID (optional; slash commands show in ~1 min) | No |

- **Login:** Use **ADMIN_PASSWORD** and/or **Login with Discord**. For Discord: in the [Developer Portal](https://discord.com/developers/applications) → your app → OAuth2 → Redirects, add `https://YOUR_RAILWAY_DOMAIN/api/auth/discord/callback`. Set `PUBLIC_URL` to that same base URL (e.g. `https://your-app.up.railway.app`).

## 4. Get your app URL

1. In Railway, open your service → **Settings** → **Networking**.
2. Click **Generate Domain**. Railway will assign a URL like `your-app.up.railway.app`.
3. Open that URL in your browser. Log in with your `ADMIN_PASSWORD` to use the scheduler and view all scheduled messages.

## 5. (Optional) Persistent data

By default, Railway’s disk is **ephemeral**: schedules and saved messages can be lost on redeploy. To keep them across deploys:

1. In Railway: open your **service** → **Volumes** tab → **Add Volume**.
2. Set the **mount path** to `/data` (or another path you prefer).
3. In **Variables**, add:
   - **`DATA_DIR`** = `/data`  
   (use the same path you chose in step 2.)
4. Redeploy if needed. The app will store `schedules.json` and `saved-messages.json` on the volume, so they persist across restarts and new deploys.

## Summary

- **Bot:** Runs 24/7 on Railway; uses `DISCORD_TOKEN` to connect to Discord.
- **Web app:** Served at your Railway URL; log in with `ADMIN_PASSWORD` to use the scheduler and see all scheduled messages.
- **Persistent data:** Set `DATA_DIR` and add a Volume at that path so schedules and saved messages survive deploys.
- **Slash commands:** If you set `GUILD_ID`, they appear in your server quickly; otherwise they can take up to an hour to show everywhere.
