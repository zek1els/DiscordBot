import express from "express";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";
import { addSchedule, listSchedules, removeSchedule, getScheduleById, setSchedulePaused, updateSchedule, getNextRun } from "./scheduler.js";
import { getAllLogChannels, removeLogChannel as removeDeletedLogChannel } from "./deletedLogConfig.js";
import { list as listSavedMessages, save as saveSavedMessage, get as getSavedMessage, remove as removeSavedMessage } from "./savedMessages.js";
import { list as listCustomCommands, add as addCustomCommand, remove as removeCustomCommand, getPrefix as getCustomCommandPrefix } from "./customCommands.js";
import { getAllConfigs as getAllJailConfigs, removeConfig as removeJailConfig } from "./jailConfig.js";
import { create as createUser, validate as validateUser, getById, getByDiscordId, setDiscord, unsetDiscord, hasAnyUser } from "./users.js";
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
/** @type {Map<string, { userId: string, email: string, discordId?: string, username?: string }>} */
const sessions = new Map();

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
  app.post("/api/auth/register", (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });
    try {
      createUser(String(email).trim(), String(password));
      const user = validateUser(String(email).trim(), String(password));
      if (!user) return res.status(500).json({ error: "Account created but login failed" });
      const sessionToken = randomBytes(24).toString("hex");
      sessions.set(sessionToken, { userId: user.id, email: user.email, discordId: user.discordId, username: user.discordUsername });
      res.setHeader("Set-Cookie", "admin_session=" + sessionToken + "; Path=/; HttpOnly; SameSite=Lax; MaxAge=604800");
      return res.json({ ok: true, user: { email: user.email, discordId: user.discordId, username: user.discordUsername } });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  });

  // Log in with email + password – public
  app.post("/api/auth/login", (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });
    const user = validateUser(String(email).trim(), String(password));
    if (!user) return res.status(401).json({ error: "Invalid email or password" });
    const sessionToken = randomBytes(24).toString("hex");
    sessions.set(sessionToken, { userId: user.id, email: user.email, discordId: user.discordId, username: user.discordUsername });
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
        sessions.set(sessionToken, { ...session, discordId, username });
        return res.redirect("/?linked=1");
      }
      const appUser = getByDiscordId(discordId);
      if (appUser) {
        const sessionTokenNew = randomBytes(24).toString("hex");
        sessions.set(sessionTokenNew, { userId: appUser.id, email: appUser.email, discordId: appUser.discordId, username: appUser.discordUsername });
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
        sessions.set(token, { userId: s.userId, email: s.email });
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/logout", (req, res) => {
    const token = getCookie(req, "admin_session");
    if (token) sessions.delete(token);
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

  /** List saved message templates (for schedules and send). */
  app.get("/api/saved-messages", (req, res) => {
    try {
      const list = listSavedMessages();
      res.json({ messages: list });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Create or overwrite a saved message (plain text from panel). */
  app.post("/api/saved-messages", (req, res) => {
    const { name, content } = req.body || {};
    if (!name || typeof name !== "string" || name.trim() === "") {
      return res.status(400).json({ error: "name required" });
    }
    try {
      const payload = { content: String(content ?? "").trim() || " " };
      saveSavedMessage(name.trim(), payload);
      res.json({ ok: true, name: name.trim().toLowerCase() });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Delete a saved message by name. */
  app.delete("/api/saved-messages/:name", (req, res) => {
    const name = req.params.name;
    if (!name) return res.status(400).json({ error: "name required" });
    try {
      const removed = removeSavedMessage(name);
      if (!removed) return res.status(404).json({ error: "Saved message not found" });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** List custom commands and prefix. */
  app.get("/api/custom-commands", (req, res) => {
    try {
      const commands = listCustomCommands();
      res.json({ prefix: getCustomCommandPrefix(), commands });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Debug: path and count so panel can show "X commands loaded from /data" and troubleshoot. */
  app.get("/api/custom-commands/debug", (req, res) => {
    try {
      const commands = listCustomCommands();
      const dataPath = join(getDataDir(), "custom-commands.json");
      res.json({ prefix: getCustomCommandPrefix(), commandsCount: commands.length, dataPath });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Create or update a custom command. */
  app.post("/api/custom-commands", (req, res) => {
    const { name, template } = req.body || {};
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name required" });
    }
    try {
      const key = addCustomCommand(name.trim(), template);
      res.json({ ok: true, name: key });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Delete a custom command by name. */
  app.delete("/api/custom-commands/:name", (req, res) => {
    const name = req.params.name;
    if (!name) return res.status(400).json({ error: "name required" });
    try {
      const removed = removeCustomCommand(name);
      if (!removed) return res.status(404).json({ error: "Custom command not found" });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Jail config: list all guilds with jail configured. */
  app.get("/api/jail-config", async (req, res) => {
    try {
      const configs = getAllJailConfigs();
      const enriched = await Promise.all(
        Object.entries(configs).map(async ([guildId, cfg]) => {
          let guildName = "";
          let memberRoleName = "";
          let criminalRoleName = "";
          try {
            const guild = await client.guilds.fetch(guildId).catch(() => null);
            if (guild) {
              guildName = guild.name;
              const mRole = guild.roles.cache.get(cfg.memberRoleId);
              memberRoleName = mRole?.name || cfg.memberRoleId;
              const cRole = guild.roles.cache.get(cfg.criminalRoleId);
              criminalRoleName = cRole?.name || cfg.criminalRoleId;
            }
          } catch (_) {}
          return { guildId, guildName, memberRoleId: cfg.memberRoleId, memberRoleName, criminalRoleId: cfg.criminalRoleId, criminalRoleName };
        })
      );
      res.json({ configs: enriched });
    } catch (e) {
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

  app.get("/api/channels", async (req, res) => {
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
