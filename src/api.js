import express from "express";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";
import { addSchedule, listSchedules, removeSchedule, getScheduleById, setSchedulePaused, updateSchedule, getNextRun } from "./scheduler.js";
import { getAllLogChannels, removeLogChannel as removeDeletedLogChannel } from "./deletedLogConfig.js";
import { list as listSavedMessages, save as saveSavedMessage, get as getSavedMessage, remove as removeSavedMessage, migrateIfNeeded as migrateSavedMessages } from "./savedMessages.js";
import { list as listCustomCommands, add as addCustomCommand, remove as removeCustomCommand, getPrefix as getCustomCommandPrefix } from "./customCommands.js";
import { getAllConfigs as getAllJailConfigs, removeConfig as removeJailConfig } from "./jailConfig.js";
import { getLeaderboard as getEcoLeaderboard, JOBS, SHOP_ITEMS, QUESTS } from "./economy.js";
import { create as createUser, validate as validateUser, getById, getByEmail, getByDiscordId, setDiscord, unsetDiscord, hasAnyUser, markVerified } from "./users.js";
import { isSmtpConfigured, sendVerificationCode, verifyCode } from "./emailVerification.js";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { getDataDir } from "./dataDir.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const apiKey = process.env.API_KEY;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID?.trim();
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET?.trim();
const PUBLIC_URL = (() => {
  const u = process.env.PUBLIC_URL?.trim() || "";
  // Reject common placeholders so OAuth doesn't use a fake redirect
  if (u && /your-app\.up\.railway\.app|example\.com|localhost/i.test(u)) return "";
  return u;
})();
const ADMIN_DISCORD_IDS = (process.env.ADMIN_DISCORD_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
/** @type {Map<string, { userId: string, email: string, discordId?: string, username?: string, expiresAt?: number }>} */
const sessions = new Map();
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, matches cookie MaxAge

function getSessionsPath() {
  return join(getDataDir(), "sessions.json");
}

function loadSessions() {
  try {
    const p = getSessionsPath();
    if (existsSync(p)) {
      const data = JSON.parse(readFileSync(p, "utf8"));
      const now = Date.now();
      for (const [token, session] of Object.entries(data)) {
        if (session.expiresAt && session.expiresAt < now) continue;
        sessions.set(token, session);
      }
      console.log(`Loaded ${sessions.size} session(s) from disk.`);
    }
  } catch (e) {
    console.error("Failed to load sessions:", e);
  }
}

function persistSessions() {
  try {
    const obj = Object.fromEntries(sessions);
    writeFileSync(getSessionsPath(), JSON.stringify(obj, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to persist sessions:", e);
  }
}

function sessionSet(token, data) {
  sessions.set(token, { ...data, expiresAt: Date.now() + SESSION_MAX_AGE_MS });
  persistSessions();
}

function sessionDelete(token) {
  sessions.delete(token);
  persistSessions();
}

loadSessions();

function getCookie(req, name) {
  const c = req.headers.cookie;
  if (!c) return null;
  const m = c.match(new RegExp("(?:^|; )" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^;]*)"));
  return m ? decodeURIComponent(m[1].trim()) : null;
}

/** Returns current user for session (userId, email, discordId?, username?), or null for API key. */
function getCurrentUser(req) {
  const sessionToken = getCookie(req, "admin_session");
  if (sessionToken) return sessions.get(sessionToken) || null;
  return null;
}

/** Owner id for schedules: Discord when linked, else app userId. */
function getOwnerId(user) {
  if (!user) return null;
  return user.discordId || user.userId || null;
}

function isAuthenticated(req) {
  const sessionToken = getCookie(req, "admin_session");
  if (sessionToken && sessions.has(sessionToken)) return true;
  const key = req.headers["x-api-key"] || (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (apiKey && key === apiKey) return true;
  return false;
}

function isAdmin(req) {
  const key = req.headers["x-api-key"] || (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (apiKey && key === apiKey) return true;
  const user = getCurrentUser(req);
  if (!user) return false;
  return ADMIN_DISCORD_IDS.length === 0 || (user.discordId && ADMIN_DISCORD_IDS.includes(user.discordId));
}

/**
 * Create Express app for send/schedule API and web UI.
 * @param {import("discord.js").Client} client
 * @returns {express.Express}
 */
export function createApi(client) {
  const app = express();
  app.use(express.json());
  migrateSavedMessages();

  function auth(req, res, next) {
    if (isAuthenticated(req)) return next();
    if (apiKey || (DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET) || hasAnyUser()) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const ip = req.ip || req.socket.remoteAddress || "";
    if (ip !== "127.0.0.1" && ip !== "::1" && ip !== "::ffff:127.0.0.1") {
      return res.status(403).json({ error: "API only allowed from localhost when no accounts exist" });
    }
    next();
  }

  // Serve web UI
  app.use(express.static(join(__dirname, "..", "public")));

  // Create account (register) – public
  app.post("/api/auth/register", async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });
    const needsVerification = isSmtpConfigured();
    try {
      createUser(String(email).trim(), String(password), { verified: !needsVerification });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    if (needsVerification) {
      const sent = await sendVerificationCode(String(email).trim());
      if (!sent) {
        return res.status(500).json({ error: "Account created but failed to send verification email. Check SMTP settings." });
      }
      return res.json({ ok: true, needsVerification: true, email: String(email).trim().toLowerCase() });
    }
    const user = validateUser(String(email).trim(), String(password));
    if (!user) return res.status(500).json({ error: "Account created but login failed" });
    const sessionToken = randomBytes(24).toString("hex");
    sessionSet(sessionToken, { userId: user.id, email: user.email, discordId: user.discordId, username: user.discordUsername });
    res.setHeader("Set-Cookie", "admin_session=" + sessionToken + "; Path=/; HttpOnly; SameSite=Lax; MaxAge=604800");
    return res.json({ ok: true, user: { email: user.email, discordId: user.discordId, username: user.discordUsername } });
  });

  // Verify email with 6-digit code – public
  app.post("/api/auth/verify", (req, res) => {
    const { email, code } = req.body || {};
    if (!email || !code) return res.status(400).json({ error: "Email and code required" });
    const result = verifyCode(String(email).trim(), String(code));
    if (result === "expired") return res.status(400).json({ error: "Code expired. Click resend to get a new one." });
    if (result === "invalid") return res.status(400).json({ error: "Invalid code. Check your email and try again." });
    markVerified(String(email).trim());
    const user = getByEmail(String(email).trim());
    if (!user) return res.status(500).json({ error: "User not found" });
    const sessionToken = randomBytes(24).toString("hex");
    sessionSet(sessionToken, { userId: user.id, email: user.email });
    res.setHeader("Set-Cookie", "admin_session=" + sessionToken + "; Path=/; HttpOnly; SameSite=Lax; MaxAge=604800");
    return res.json({ ok: true, user: { email: user.email } });
  });

  // Resend verification code – public
  app.post("/api/auth/resend-code", async (req, res) => {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "Email required" });
    const user = getByEmail(String(email).trim());
    if (!user) return res.status(404).json({ error: "No account with this email" });
    if (user.verified) return res.json({ ok: true, alreadyVerified: true });
    const sent = await sendVerificationCode(String(email).trim());
    if (!sent) return res.status(500).json({ error: "Failed to send email. Check SMTP settings." });
    return res.json({ ok: true });
  });

  // Log in with email + password – public
  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });
    const user = validateUser(String(email).trim(), String(password));
    if (!user) return res.status(401).json({ error: "Invalid email or password" });
    if (!user.verified && isSmtpConfigured()) {
      await sendVerificationCode(String(email).trim());
      return res.status(403).json({ error: "Email not verified. A new code has been sent to your inbox.", needsVerification: true, email: user.email });
    }
    const sessionToken = randomBytes(24).toString("hex");
    sessionSet(sessionToken, { userId: user.id, email: user.email, discordId: user.discordId, username: user.discordUsername });
    res.setHeader("Set-Cookie", "admin_session=" + sessionToken + "; Path=/; HttpOnly; SameSite=Lax; MaxAge=604800");
    return res.json({ ok: true, user: { email: user.email, discordId: user.discordId, username: user.discordUsername } });
  });

  // Discord OAuth2: redirect to Discord (?link=1 to link when already logged in)
  app.get("/api/auth/discord", (req, res) => {
    if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !PUBLIC_URL) {
      return res.status(503).json({ error: "Discord not configured (DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, PUBLIC_URL)" });
    }
    const redirectUri = PUBLIC_URL.replace(/\/$/, "") + "/api/auth/discord/callback";
    const isLink = req.query.link === "1";
    const sessionToken = getCookie(req, "admin_session");
    const session = sessionToken ? sessions.get(sessionToken) : null;
    if (isLink && (!session || !session.userId)) {
      return res.redirect("/?error=link_requires_login");
    }
    const url = new URL("https://discord.com/api/oauth2/authorize");
    url.searchParams.set("client_id", DISCORD_CLIENT_ID);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "identify");
    url.searchParams.set("state", isLink ? "link" : "login");
    res.redirect(url.toString());
  });

  // Discord OAuth2: callback (link account or login with Discord)
  app.get("/api/auth/discord/callback", async (req, res) => {
    const { code, state } = req.query;
    if (!code || !DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !PUBLIC_URL) {
      return res.redirect("/?error=discord_config");
    }
    const redirectUri = PUBLIC_URL.replace(/\/$/, "") + "/api/auth/discord/callback";
    const isLink = state === "link";
    const sessionToken = getCookie(req, "admin_session");
    const session = sessionToken ? sessions.get(sessionToken) : null;
    try {
      const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: DISCORD_CLIENT_ID,
          client_secret: DISCORD_CLIENT_SECRET,
          grant_type: "authorization_code",
          code: String(code),
          redirect_uri: redirectUri,
        }),
      });
      if (!tokenRes.ok) {
        const err = await tokenRes.text();
        return res.redirect("/?error=discord_token&m=" + encodeURIComponent(err.slice(0, 80)));
      }
      const tokenData = await tokenRes.json();
      const userRes = await fetch("https://discord.com/api/users/@me", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (!userRes.ok) return res.redirect("/?error=discord_user");
      const discordUser = await userRes.json();
      const discordId = discordUser.id;
      const username = discordUser.username || discordUser.global_name || "User";
      if (isLink && session?.userId) {
        setDiscord(session.userId, discordId, username);
        sessionSet(sessionToken, { ...session, discordId, username });
        return res.redirect("/?linked=1");
      }
      const appUser = getByDiscordId(discordId);
      if (appUser) {
        const sessionTokenNew = randomBytes(24).toString("hex");
        sessionSet(sessionTokenNew, { userId: appUser.id, email: appUser.email, discordId: appUser.discordId, username: appUser.discordUsername });
        res.setHeader("Set-Cookie", "admin_session=" + sessionTokenNew + "; Path=/; HttpOnly; SameSite=Lax; MaxAge=604800");
        return res.redirect("/");
      }
      return res.redirect("/?error=discord_not_linked");
    } catch (e) {
      console.error("Discord OAuth error:", e);
      return res.redirect("/?error=discord_failed");
    }
  });

  app.post("/api/auth/unlink-discord", (req, res) => {
    const user = getCurrentUser(req);
    if (!user || !user.userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      unsetDiscord(user.userId);
      const token = getCookie(req, "admin_session");
      if (token && sessions.has(token)) {
        const s = sessions.get(token);
        sessionSet(token, { userId: s.userId, email: s.email });
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/logout", (req, res) => {
    const token = getCookie(req, "admin_session");
    if (token) sessionDelete(token);
    res.setHeader("Set-Cookie", "admin_session=; Path=/; HttpOnly; MaxAge=0");
    res.json({ ok: true });
  });

  app.get("/api/auth/check", (req, res) => {
    if (!isAuthenticated(req)) return res.status(401).json({ ok: false });
    const user = getCurrentUser(req);
    res.json({
      ok: true,
      isAdmin: isAdmin(req),
      user: user ? { email: user.email, discordId: user.discordId, username: user.username } : null,
    });
  });

  app.get("/api/auth/config", (req, res) => {
    res.json({
      discordLogin: !!(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET && PUBLIC_URL),
      canRegister: true,
      emailVerification: isSmtpConfigured(),
    });
  });

  app.get("/api/auth/redirect-uri", (req, res) => {
    const redirectUri = PUBLIC_URL ? PUBLIC_URL.replace(/\/$/, "") + "/api/auth/discord/callback" : null;
    res.json({
      redirectUri,
      publicUrl: PUBLIC_URL || null,
      hint: redirectUri
        ? "Add this EXACT URL in Discord Developer Portal → your app → OAuth2 → Redirects (https, no trailing slash)."
        : "Set PUBLIC_URL in your environment to your app's public URL (e.g. https://your-app.up.railway.app).",
    });
  });

  // All other /api routes require auth (auth/config and auth/redirect-uri are above, so public) (login/logout/auth/check are above and match first)
  app.use("/api", auth);

  /** Admin only: list servers (guilds) the bot is in */
  app.get("/api/bot/servers", async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin only" });
    try {
      const servers = client.guilds.cache.map((g) => ({
        id: g.id,
        name: g.name,
        memberCount: g.memberCount ?? 0,
      }));
      res.json({ servers });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Get channels where deleted-message logs are sent (run /log-deletes here in Discord to add). Enriched with guild/channel names. */
  app.get("/api/deleted-log-config", async (req, res) => {
    try {
      const channels = getAllLogChannels();
      const enriched = await Promise.all(
        channels.map(async (c) => {
          let guildName = "";
          let channelName = "";
          try {
            const ch = await client.channels.fetch(c.channelId).catch(() => null);
            if (ch) {
              channelName = ch.name || "";
              guildName = ch.guild?.name || "";
            }
          } catch (_) {}
          return { channelId: c.channelId, guildId: c.guildId, guildName, channelName };
        })
      );
      res.json({ channels: enriched });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Remove a channel from receiving deleted logs (admin only). Use /log-deletes off in Discord to disable from there. */
  app.delete("/api/deleted-log-config/channel/:channelId", (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin only" });
    const { channelId } = req.params;
    if (!channelId) return res.status(400).json({ error: "channelId required" });
    try {
      const removed = removeDeletedLogChannel(channelId);
      res.json({ ok: true, removed });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** List saved message templates for the current user. */
  app.get("/api/saved-messages", (req, res) => {
    try {
      const user = getCurrentUser(req);
      const ownerId = getOwnerId(user) || "_global";
      const list = listSavedMessages(ownerId);
      res.json({ messages: list });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Create or overwrite a saved message for the current user. */
  app.post("/api/saved-messages", (req, res) => {
    const { name, content } = req.body || {};
    if (!name || typeof name !== "string" || name.trim() === "") {
      return res.status(400).json({ error: "name required" });
    }
    try {
      const user = getCurrentUser(req);
      const ownerId = getOwnerId(user) || "_global";
      const payload = { content: String(content ?? "").trim() || " " };
      saveSavedMessage(name.trim(), payload, ownerId);
      res.json({ ok: true, name: name.trim().toLowerCase() });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Delete a saved message by name for the current user. */
  app.delete("/api/saved-messages/:name", (req, res) => {
    const name = req.params.name;
    if (!name) return res.status(400).json({ error: "name required" });
    try {
      const user = getCurrentUser(req);
      const ownerId = getOwnerId(user) || "_global";
      const removed = removeSavedMessage(name, ownerId);
      if (!removed) return res.status(404).json({ error: "Saved message not found" });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** List custom commands for a guild. */
  app.get("/api/custom-commands", (req, res) => {
    const guildId = req.query.guildId;
    if (!guildId) return res.status(400).json({ error: "guildId query parameter required" });
    try {
      const commands = listCustomCommands(guildId);
      res.json({ prefix: getCustomCommandPrefix(), commands });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Create or update a custom command for a guild. */
  app.post("/api/custom-commands", (req, res) => {
    const { name, template, guildId } = req.body || {};
    if (!guildId) return res.status(400).json({ error: "guildId required" });
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name required" });
    }
    try {
      const key = addCustomCommand(name.trim(), template, guildId);
      res.json({ ok: true, name: key });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Delete a custom command by name for a guild. */
  app.delete("/api/custom-commands/:name", (req, res) => {
    const name = req.params.name;
    const guildId = req.query.guildId;
    if (!name) return res.status(400).json({ error: "name required" });
    if (!guildId) return res.status(400).json({ error: "guildId query parameter required" });
    try {
      const removed = removeCustomCommand(name, guildId);
      if (!removed) return res.status(404).json({ error: "Custom command not found" });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Jail config: list all guilds with jail configured. No async Discord API calls. */
  app.get("/api/jail-config", (req, res) => {
    try {
      const configs = getAllJailConfigs();
      const enriched = Object.entries(configs).map(([guildId, cfg]) => {
        const guild = client.guilds.cache.get(guildId);
        const roleName = (id) => guild?.roles?.cache?.get(id)?.name || id;
        return {
          guildId,
          guildName: guild?.name || guildId,
          memberRoleId: cfg?.memberRoleId || "?",
          memberRoleName: roleName(cfg?.memberRoleId),
          criminalRoleId: cfg?.criminalRoleId || "?",
          criminalRoleName: roleName(cfg?.criminalRoleId),
          allowedRoleIds: cfg?.allowedRoleIds || [],
          allowedRoleNames: (cfg?.allowedRoleIds || []).map((id) => roleName(id)),
        };
      });
      res.json({ configs: enriched });
    } catch (e) {
      console.error("GET /api/jail-config failed:", e);
      res.status(500).json({ error: e.message });
    }
  });

  /** Remove jail config for a guild (admin only). */
  app.delete("/api/jail-config/:guildId", (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin only" });
    const { guildId } = req.params;
    try {
      const removed = removeJailConfig(guildId);
      if (!removed) return res.status(404).json({ error: "Not found" });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Guild list — admin sees all, non-admin sees nothing */
  app.get("/api/guilds", (req, res) => {
    if (!isAdmin(req)) return res.json({ guilds: [] });
    try {
      const guilds = client.guilds.cache.map((g) => ({ id: g.id, name: g.name }));
      res.json({ guilds });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Debug: show raw data dir and file contents for diagnosing persistence issues */
  app.get("/api/debug/data", (req, res) => {
    try {
      const dir = getDataDir();
      const jailPath = join(dir, "jail-config.json");
      const ecoPath = join(dir, "economy.json");
      const jailExists = existsSync(jailPath);
      const ecoExists = existsSync(ecoPath);
      let jailRaw = null, ecoKeys = null;
      if (jailExists) try { jailRaw = JSON.parse(readFileSync(jailPath, "utf8")); } catch (_) { jailRaw = "parse error"; }
      if (ecoExists) try { ecoKeys = Object.keys(JSON.parse(readFileSync(ecoPath, "utf8"))); } catch (_) { ecoKeys = "parse error"; }
      res.json({
        dataDir: dir,
        railwayEnv: process.env.RAILWAY_ENVIRONMENT || null,
        dataDirEnv: process.env.DATA_DIR || null,
        jailConfigExists: jailExists,
        jailConfig: jailRaw,
        economyExists: ecoExists,
        economyUserCount: Array.isArray(ecoKeys) ? ecoKeys.length : ecoKeys,
        guildsInCache: client.guilds.cache.size,
        guildIds: client.guilds.cache.map((g) => g.id),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Economy: leaderboard for a guild. Uses cache only, no Discord API calls. */
  app.get("/api/economy/leaderboard/:guildId", (req, res) => {
    try {
      const lb = getEcoLeaderboard(req.params.guildId, 20);
      const enriched = lb.map((entry) => {
        const cached = client.users.cache.get(entry.userId);
        return { ...entry, username: cached?.displayName || cached?.username || entry.userId };
      });
      res.json({ leaderboard: enriched });
    } catch (e) {
      console.error("GET /api/economy/leaderboard failed:", e);
      res.status(500).json({ error: e.message });
    }
  });

  /** Economy: static info (jobs, shop, quests) */
  app.get("/api/economy/info", (req, res) => {
    try {
      res.json({ jobs: JOBS || [], shop: SHOP_ITEMS || [], quests: QUESTS || [] });
    } catch (e) {
      console.error("GET /api/economy/info failed:", e);
      res.status(500).json({ error: e.message });
    }
  });

  /** Channels list — admin only */
  app.get("/api/channels", async (req, res) => {
    if (!isAdmin(req)) return res.json({ guilds: [] });
    try {
      const guilds = [];
      for (const [id, guild] of client.guilds.cache) {
        const channels = [];
        for (const [cId, ch] of guild.channels.cache) {
          if (ch.isTextBased && ch.viewable) {
            channels.push({ id: cId, name: ch.name });
          }
        }
        channels.sort((a, b) => a.name.localeCompare(b.name));
        guilds.push({ id, name: guild.name, channels });
      }
      res.json({ guilds });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/send", async (req, res) => {
    const { channelId, content } = req.body || {};
    if (!channelId || content == null) {
      return res.status(400).json({ error: "channelId and content required" });
    }
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel?.isTextBased) {
        return res.status(400).json({ error: "Channel not found or not text channel" });
      }
      await channel.send({ content: String(content).trim() || " " });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/schedule", async (req, res) => {
    const body = req.body || {};
    const { channelId, content, messages: messagesBody, savedMessageNames: savedNamesBody, scheduleType } = body;
    const hasContent = content != null && String(content).trim() !== "";
    const messagesArray = Array.isArray(messagesBody) ? messagesBody.filter((m) => m != null && String(m).trim() !== "") : [];
    const hasMessages = messagesArray.length > 0;
    const savedNames = Array.isArray(savedNamesBody) ? savedNamesBody.map((n) => String(n).trim()).filter(Boolean) : [];
    const hasSaved = savedNames.length > 0;
    if (!channelId || !scheduleType) {
      return res.status(400).json({
        error: "channelId and scheduleType required (scheduleType: interval_minutes | daily | weekly)",
      });
    }
    if (!hasContent && !hasMessages && !hasSaved) {
      return res.status(400).json({
        error: "Provide messages (plain text), savedMessageNames (saved template names), or content.",
      });
    }
    const user = getCurrentUser(req);
    const options = {
      timezone: body.timezone || "UTC",
      minutes: body.minutes ?? 1,
      time: body.time || "00:00",
      day_of_week: body.day_of_week ?? 0,
    };
    try {
      const payload = hasMessages ? undefined : hasSaved ? undefined : { content: String(content).trim() || " " };
      const messages = hasMessages ? messagesArray.map((m) => String(m).trim() || " ") : undefined;
      const savedMessageNames = hasSaved ? savedNames : undefined;
      const { id, label } = addSchedule({
        channelId: String(channelId),
        payload,
        messages,
        savedMessageNames,
        scheduleType,
        options,
        createdBy: getOwnerId(user) || null,
      });
      res.json({ ok: true, id, label });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/schedules", async (req, res) => {
    try {
      let list = listSchedules();
      const user = getCurrentUser(req);
      const admin = isAdmin(req);
      if (!admin && user) {
        const ownerId = getOwnerId(user);
        list = list.filter((s) => s.createdBy === ownerId);
      } else if (!admin) {
        list = [];
      }
      const enriched = await Promise.all(
        list.map(async (s) => {
          let serverName = "";
          let channelName = "";
          try {
            const ch = await client.channels.fetch(s.channelId);
            if (ch) {
              channelName = ch.name || "";
              serverName = ch.guild?.name || "";
            }
          } catch (_) {}
          const full = getScheduleById(s.id);
          const nextRunAt = full ? getNextRun(full) : null;
          return { ...s, serverName, channelName, nextRunAt };
        })
      );
      res.json({ schedules: enriched });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/schedules/:id", (req, res) => {
    const id = req.params.id;
    const schedule = getScheduleById(id);
    if (!schedule) return res.status(404).json({ error: "Schedule not found" });
    const user = getCurrentUser(req);
    const admin = isAdmin(req);
    if (!admin && user && schedule.createdBy !== getOwnerId(user)) {
      return res.status(403).json({ error: "You can only delete your own schedules" });
    }
    const removed = removeSchedule(id);
    if (!removed) return res.status(404).json({ error: "Schedule not found" });
    res.json({ ok: true });
  });

  function canEditSchedule(req, schedule) {
    if (isAdmin(req)) return true;
    const user = getCurrentUser(req);
    return user && schedule.createdBy === getOwnerId(user);
  }

  app.patch("/api/schedules/:id", (req, res) => {
    const id = req.params.id;
    const schedule = getScheduleById(id);
    if (!schedule) return res.status(404).json({ error: "Schedule not found" });
    if (!canEditSchedule(req, schedule)) {
      return res.status(403).json({ error: "You can only edit your own schedules" });
    }
    const body = req.body || {};
    if (typeof body.paused === "boolean") {
      const ok = setSchedulePaused(id, body.paused);
      if (!ok) return res.status(404).json({ error: "Schedule not found" });
      return res.json({ ok: true, paused: body.paused });
    }
    const updates = {};
    if (body.content != null) updates.content = body.content;
    if (body.messages != null) updates.messages = Array.isArray(body.messages) ? body.messages : [body.content];
    if (body.savedMessageNames != null) updates.savedMessageNames = Array.isArray(body.savedMessageNames) ? body.savedMessageNames : [];
    if (body.scheduleType != null) updates.scheduleType = body.scheduleType;
    if (body.timezone != null) updates.timezone = body.timezone;
    if (body.minutes != null) updates.minutes = body.minutes;
    if (body.time != null) updates.time = body.time;
    if (body.day_of_week != null) updates.day_of_week = body.day_of_week;
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No updates provided (paused, content, messages, scheduleType, timezone, minutes, time, day_of_week)" });
    }
    const result = updateSchedule(id, updates);
    if (!result) return res.status(404).json({ error: "Schedule not found" });
    res.json({ ok: true, id: result.id, label: result.label });
  });

  /** Get one schedule by id (for edit form). Owner or admin. */
  app.get("/api/schedules/:id", (req, res) => {
    const id = req.params.id;
    const schedule = getScheduleById(id);
    if (!schedule) return res.status(404).json({ error: "Schedule not found" });
    if (!canEditSchedule(req, schedule)) {
      return res.status(403).json({ error: "You can only view your own schedules" });
    }
    const messages = schedule.messages?.length ? schedule.messages : [schedule.payload?.content ?? ""];
    res.json({
      id: schedule.id,
      channelId: schedule.channelId,
      content: messages[0] ?? "",
      messages,
      savedMessageNames: schedule.savedMessageNames || [],
      scheduleType: schedule.scheduleType,
      timezone: schedule.options?.timezone || "UTC",
      minutes: schedule.options?.minutes ?? 5,
      time: schedule.options?.time || "00:00",
      day_of_week: schedule.options?.day_of_week ?? 0,
      paused: !!schedule.paused,
      label: schedule.label,
    });
  });

  return app;
}
