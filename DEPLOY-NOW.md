# Deploy now (you have GitHub + Railway)

Your project is committed and ready. Follow these steps in order.

---

## Step 1: Create a repo on GitHub

1. Open **https://github.com/new**
2. **Repository name:** `DiscordBot` (or any name you like)
3. Leave it **empty** (no README, no .gitignore)
4. Click **Create repository**

---

## Step 2: Push this project to GitHub

In a terminal, in this folder (`DiscordBot`), run (replace `YOUR_USERNAME` and `YOUR_REPO` with your GitHub username and repo name):

```powershell
cd "c:\Users\maxim\Documents\Projects\DiscordBot"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git branch -M main
git push -u origin main
```

Example: if your username is `maxim` and repo is `DiscordBot`:

```powershell
git remote add origin https://github.com/maxim/DiscordBot.git
git branch -M main
git push -u origin main
```

---

## Step 3: Deploy on Railway

1. Open **https://railway.app** and log in (with GitHub if you like).
2. Click **New Project** → **Deploy from GitHub repo**.
3. Choose the repo you just pushed (e.g. `DiscordBot`).
4. After it deploys, open your service → **Variables** → **Add variables:**
   - `DISCORD_TOKEN` = your bot token from [Discord Developer Portal](https://discord.com/developers/applications) → your app → Bot → Reset Token / Copy
   - `API_KEY` = any long random string (e.g. `mySecretKey123!`); you’ll type this in the web app later
5. Open **Settings** → **Networking** → **Generate Domain**.
6. Open the generated URL (e.g. `https://discordbot-production-xxxx.up.railway.app`). You should see the scheduler page. Enter your `API_KEY` in the box at the top and use the app.

Done. Your bot runs 24/7 and the web app is available at that URL.
