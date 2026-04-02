import express from "express";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getAllLogChannels, removeLogChannel as removeDeletedLogChannel } from "./deletedLogConfig.js";
import { list as listSavedMessages, save as saveSavedMessage, get as getSavedMessage, remove as removeSavedMessage, migrateIfNeeded as migrateSavedMessages } from "./savedMessages.js";
import { list as listCustomCommands, add as addCustomCommand, remove as removeCustomCommand, getPrefix as getCustomCommandPrefix } from "./customCommands.js";
import { getAllConfigs as getAllJailConfigs, removeConfig as removeJailConfig, getConfig as getJailConfig, saveJailedRoles, popJailedRoles } from "./jailConfig.js";
import { getLeaderboard as getEcoLeaderboard, JOBS, SHOP_ITEMS, QUESTS } from "./economy.js";
import { hasAnyUser } from "./users.js";
import { getLeaderboard as getLevelLeaderboard, getStats as getLevelStats, getAllGuildStats } from "./levels.js";
import { getAllGuildWarnings, getWarnings, addWarning } from "./warnings.js";
import { getLog as getAuditLog, log as auditLog } from "./auditLog.js";
import { getDb } from "./storage.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerScheduleRoutes } from "./routes/schedules.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { getModLogHistory, sendModLog } from "./modLog.js";
import { getActivitySummary, getCommandStats, getMessageStats, getMemberGrowth, getPeakHours } from "./analytics.js";
import { getCacheStatus, cacheGuild, resetCacheStatus } from "./messageCache.js";
import { getConfessionHistory } from "./confessions.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const apiKey = process.env.API_KEY;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID?.trim();
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET?.trim();
const ADMIN_DISCORD_IDS = (process.env.ADMIN_DISCORD_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
/** @type {Map<string, { userId: string, email: string, discordId?: string, username?: string, expiresAt?: number }>} */
const sessions = new Map();
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, matches cookie Max-Age

function ensureSessionTable() {
  getDb().exec(`CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`);
}

function loadSessions() {
  try {
    ensureSessionTable();
    const db = getDb();
    const now = Date.now();
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
    const rows = db.prepare("SELECT token, data FROM sessions").all();
    for (const row of rows) {
      sessions.set(row.token, JSON.parse(row.data));
    }
    console.log(`Loaded ${sessions.size} session(s).`);
  } catch (e) {
    console.error("Failed to load sessions:", e);
  }
}

function sessionSet(token, data) {
  const sessionData = { ...data, expiresAt: Date.now() + SESSION_MAX_AGE_MS };
  sessions.set(token, sessionData);
  try {
    ensureSessionTable();
    getDb().prepare("INSERT OR REPLACE INTO sessions (token, data, expires_at) VALUES (?, ?, ?)").run(token, JSON.stringify(sessionData), sessionData.expiresAt);
  } catch (e) { console.error("Failed to persist session:", e); }
}

function sessionDelete(token) {
  sessions.delete(token);
  try { getDb().prepare("DELETE FROM sessions WHERE token = ?").run(token); } catch {}
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

  // Bot invite redirect
  app.get("/invite", (req, res) => {
    if (!DISCORD_CLIENT_ID) return res.status(503).send("Bot client ID not configured.");
    const url = `https://discord.com/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&permissions=8&scope=bot%20applications.commands`;
    res.redirect(url);
  });

  const helpers = { sessions, sessionSet, sessionDelete, getCookie, getCurrentUser, getOwnerId, isAuthenticated, isAdmin };

  // Auth routes (registered BEFORE the auth middleware so they remain public)
  registerAuthRoutes(app, helpers);

  // All other /api routes require auth
  app.use("/api", auth);

  // Admin routes
  registerAdminRoutes(app, client, { isAdmin, getCurrentUser, sessions, sessionDelete });

  // Schedule routes
  registerScheduleRoutes(app, client, { getCurrentUser, getOwnerId, isAdmin });

  // --- Inline smaller route groups ---

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

  app.get("/api/user/guilds", (req, res) => {
    const user = getCurrentUser(req);
    if (!user?.discordId) return res.json({ guilds: [] });
    const userGuilds = [];
    for (const [id, guild] of client.guilds.cache) {
      const member = guild.members.cache.get(user.discordId);
      if (member) {
        userGuilds.push({ id, name: guild.name });
      }
    }
    res.json({ guilds: userGuilds });
  });

  app.get("/api/guilds", (req, res) => {
    if (!isAdmin(req)) return res.json({ guilds: [] });
    try {
      const guilds = client.guilds.cache.map((g) => ({ id: g.id, name: g.name }));
      res.json({ guilds });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

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

  app.get("/api/economy/info", (req, res) => {
    try {
      res.json({ jobs: JOBS || [], shop: SHOP_ITEMS || [], quests: QUESTS || [] });
    } catch (e) {
      console.error("GET /api/economy/info failed:", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/channels", async (req, res) => {
    if (!isAdmin(req)) return res.json({ guilds: [] });
    try {
      const guilds = [];
      for (const [id, guild] of client.guilds.cache) {
        const channels = [];
        for (const [cId, ch] of guild.channels.cache) {
          if (ch.isTextBased() && ch.viewable) {
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

  // --- Levels & Leaderboards ---
  app.get("/api/levels/leaderboard/:guildId", (req, res) => {
    const type = req.query.type || "xp";
    try {
      const lb = getLevelLeaderboard(req.params.guildId, type, 20);
      const enriched = lb.map((e) => {
        const cached = client.users.cache.get(e.userId);
        return { ...e, username: cached?.displayName || cached?.username || e.userId };
      });
      res.json({ leaderboard: enriched });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/levels/stats/:guildId", (req, res) => {
    try {
      res.json(getAllGuildStats(req.params.guildId));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/levels/user/:guildId/:userId", (req, res) => {
    try {
      res.json(getLevelStats(req.params.guildId, req.params.userId));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Warnings (admin) ---
  app.get("/api/warnings/:guildId", (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin only" });
    try {
      const warnings = getAllGuildWarnings(req.params.guildId);
      const enriched = warnings.map((w) => {
        const user = client.users.cache.get(w.userId);
        const mod = client.users.cache.get(w.moderatorId);
        return {
          ...w,
          username: user?.displayName || user?.username || w.userId,
          moderatorName: mod?.displayName || mod?.username || w.moderatorId,
        };
      });
      res.json({ warnings: enriched });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Audit Log (admin) ---
  app.get("/api/audit-log/:guildId", (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin only" });
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    try {
      const log = getAuditLog(req.params.guildId, limit);
      const enriched = log.map((entry) => {
        const out = { ...entry };
        if (entry.userId) {
          const u = client.users.cache.get(entry.userId);
          out.username = u?.displayName || u?.username || entry.userId;
        }
        if (entry.moderatorId) {
          const m = client.users.cache.get(entry.moderatorId);
          out.moderatorName = m?.displayName || m?.username || entry.moderatorId;
        }
        return out;
      });
      res.json({ log: enriched });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Mod Log History ---
  app.get("/api/modlog/:guildId", (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin only" });
    try {
      const { action, userId, page, limit } = req.query;
      const result = getModLogHistory(req.params.guildId, {
        action: action || undefined,
        userId: userId || undefined,
        page: parseInt(page) || 1,
        limit: parseInt(limit) || 50,
      });
      // Enrich with usernames from cache
      result.entries = result.entries.map((e) => {
        const user = e.user_id ? client?.users?.cache?.get(e.user_id) : null;
        const mod = e.moderator_id ? client?.users?.cache?.get(e.moderator_id) : null;
        return {
          ...e,
          username: user?.displayName || user?.username || e.user_id,
          moderatorName: mod?.displayName || mod?.username || e.moderator_id,
        };
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Analytics ---
  app.get("/api/analytics/summary/:guildId", (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin only" });
    try {
      res.json(getActivitySummary(req.params.guildId));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/analytics/commands/:guildId", (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin only" });
    try {
      const days = parseInt(req.query.days) || 7;
      res.json({ commands: getCommandStats(req.params.guildId, days) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/analytics/messages/:guildId", (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin only" });
    try {
      const days = parseInt(req.query.days) || 7;
      res.json({ messages: getMessageStats(req.params.guildId, days) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/analytics/growth/:guildId", (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin only" });
    try {
      const days = parseInt(req.query.days) || 7;
      res.json(getMemberGrowth(req.params.guildId, days));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/analytics/peak-hours/:guildId", (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin only" });
    try {
      const days = parseInt(req.query.days) || 7;
      res.json({ hours: getPeakHours(req.params.guildId, days) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Message Cache ---
  app.get("/api/analytics/cache-status/:guildId", (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin only" });
    try {
      res.json(getCacheStatus(req.params.guildId));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/analytics/cache/:guildId", async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin only" });
    try {
      const guild = client?.guilds?.cache?.get(req.params.guildId);
      if (!guild) return res.status(404).json({ error: "Guild not found" });
      const reset = req.body?.reset === true;
      if (reset) resetCacheStatus(req.params.guildId);
      // Start caching in background, return immediately
      res.json({ ok: true, message: "Cache started. Check status with GET /api/analytics/cache-status/" + req.params.guildId });
      cacheGuild(guild).then((r) => {
        console.log(`[API] Message cache complete for ${guild.name}: ${r.totalMessages} messages`);
      }).catch((e) => console.error("[API] Message cache failed:", e.message));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Mod Actions (from web panel) ---
  app.post("/api/mod/warn/:guildId", async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin only" });
    const { userId, reason } = req.body || {};
    if (!userId || !reason) return res.status(400).json({ error: "userId and reason required" });
    try {
      const user = getCurrentUser(req);
      const modId = user?.discordId || "web-panel";
      const { warning, total } = addWarning(req.params.guildId, userId, reason, modId);
      auditLog(req.params.guildId, "warn", { userId, moderatorId: modId, reason });
      sendModLog(client, req.params.guildId, "warn", { userId, moderatorId: modId, reason });
      res.json({ ok: true, warning, total });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/mod/jail/:guildId", async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin only" });
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: "userId required" });
    try {
      const cfg = getJailConfig(req.params.guildId);
      if (!cfg?.criminalRoleId) return res.status(400).json({ error: "Jail not configured" });
      const guild = client.guilds.cache.get(req.params.guildId);
      if (!guild) return res.status(404).json({ error: "Guild not found" });
      const member = await guild.members.fetch(userId);
      const currentRoleIds = member.roles.cache
        .filter((r) => r.id !== guild.id && r.id !== cfg.criminalRoleId)
        .map((r) => r.id);
      saveJailedRoles(req.params.guildId, userId, currentRoleIds);
      const rolesToRemove = currentRoleIds.filter((id) => id !== cfg.criminalRoleId);
      if (rolesToRemove.length > 0) await member.roles.remove(rolesToRemove);
      await member.roles.add(cfg.criminalRoleId);
      const user = getCurrentUser(req);
      const modId = user?.discordId || "web-panel";
      auditLog(req.params.guildId, "jail", { userId, moderatorId: modId });
      sendModLog(client, req.params.guildId, "jail", { userId, moderatorId: modId });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/mod/unjail/:guildId", async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin only" });
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: "userId required" });
    try {
      const cfg = getJailConfig(req.params.guildId);
      if (!cfg?.criminalRoleId) return res.status(400).json({ error: "Jail not configured" });
      const guild = client.guilds.cache.get(req.params.guildId);
      if (!guild) return res.status(404).json({ error: "Guild not found" });
      const member = await guild.members.fetch(userId);
      if (cfg.criminalRoleId) await member.roles.remove(cfg.criminalRoleId);
      const savedRoles = popJailedRoles(req.params.guildId, userId);
      if (savedRoles?.length > 0) await member.roles.add(savedRoles);
      else if (cfg.memberRoleId) await member.roles.add(cfg.memberRoleId);
      const user = getCurrentUser(req);
      const modId = user?.discordId || "web-panel";
      auditLog(req.params.guildId, "unjail", { userId, moderatorId: modId });
      sendModLog(client, req.params.guildId, "unjail", { userId, moderatorId: modId });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Live Server Stats ---
  app.get("/api/stats/:guildId", async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin only" });
    try {
      const guild = client?.guilds?.cache?.get(req.params.guildId);
      if (!guild) return res.status(404).json({ error: "Guild not found" });

      // Fetch members with presence data for accurate online count
      try { await guild.members.fetch({ withPresences: true }); } catch (_) {}

      const online = guild.members.cache.filter((m) => m.presence?.status && m.presence.status !== "offline").size;
      const voiceMembers = guild.channels.cache
        .filter((c) => c.type === 2) // GuildVoice
        .reduce((sum, c) => sum + c.members.size, 0);
      res.json({
        name: guild.name,
        icon: guild.iconURL({ size: 128 }),
        memberCount: guild.memberCount,
        online,
        voiceMembers,
        channels: guild.channels.cache.size,
        roles: guild.roles.cache.size,
        boostLevel: guild.premiumTier,
        boostCount: guild.premiumSubscriptionCount || 0,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Guild Members Search ---
  app.get("/api/members/:guildId", async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin only" });
    try {
      const guild = client?.guilds?.cache?.get(req.params.guildId);
      if (!guild) return res.status(404).json({ error: "Guild not found" });
      const query = (req.query.q || "").trim().toLowerCase();
      let members;
      if (query) {
        members = guild.members.cache.filter((m) =>
          m.user.username.toLowerCase().includes(query) ||
          (m.nickname && m.nickname.toLowerCase().includes(query)) ||
          m.user.id.includes(query)
        );
      } else {
        members = guild.members.cache;
      }
      const result = [...members.values()].slice(0, 50).map((m) => ({
        id: m.user.id,
        username: m.user.username,
        displayName: m.nickname || m.user.globalName || m.user.username,
        avatar: m.user.displayAvatarURL({ size: 32 }),
        bot: m.user.bot,
      })).filter((m) => !m.bot);
      res.json({ members: result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Confession Viewer (admin) ---
  app.get("/api/confessions/:guildId", async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin only" });
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const data = getConfessionHistory(req.params.guildId, { page, limit });
      // Resolve user IDs to usernames
      const guild = client?.guilds?.cache?.get(req.params.guildId);
      for (const c of data.confessions) {
        if (c.user_id && guild) {
          try {
            const member = guild.members.cache.get(c.user_id) || await guild.members.fetch(c.user_id).catch(() => null);
            if (member) {
              c.username = member.user.username;
              c.displayName = member.nickname || member.user.globalName || member.user.username;
            }
          } catch (e) { console.error("Confession user resolve failed:", c.user_id, e.message); }
        }
      }
      res.json(data);
    } catch (e) {
      res.json({ confessions: [], total: 0, page: 1, totalPages: 1 });
    }
  });

  return app;
}
