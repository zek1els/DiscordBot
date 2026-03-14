import express from "express";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";
import { addSchedule, listSchedules, removeSchedule } from "./scheduler.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const apiKey = process.env.API_KEY;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID?.trim();
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET?.trim();
const PUBLIC_URL = process.env.PUBLIC_URL?.trim() || "";
const ALLOWED_DISCORD_IDS = (process.env.ALLOWED_DISCORD_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const sessions = new Set();

function getCookie(req, name) {
  const c = req.headers.cookie;
  if (!c) return null;
  const m = c.match(new RegExp("(?:^|; )" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^;]*)"));
  return m ? decodeURIComponent(m[1].trim()) : null;
}

function isAdmin(req) {
  const sessionToken = getCookie(req, "admin_session");
  if (sessionToken && sessions.has(sessionToken)) return true;
  const key = req.headers["x-api-key"] || (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (apiKey && key === apiKey) return true;
  return false;
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
    if (ADMIN_PASSWORD || apiKey || (DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET)) {
      if (!isAdmin(req)) return res.status(401).json({ error: "Unauthorized" });
      return next();
    }
    const ip = req.ip || req.socket.remoteAddress || "";
    if (ip !== "127.0.0.1" && ip !== "::1" && ip !== "::ffff:127.0.0.1") {
      return res.status(403).json({ error: "API only allowed from localhost when no auth is configured" });
    }
    next();
  }

  // Serve web UI
  app.use(express.static(join(__dirname, "..", "public")));

  // Discord OAuth2: redirect to Discord
  app.get("/api/auth/discord", (req, res) => {
    if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !PUBLIC_URL) {
      return res.status(503).json({ error: "Discord login not configured (DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, PUBLIC_URL)" });
    }
    const redirectUri = PUBLIC_URL.replace(/\/$/, "") + "/api/auth/discord/callback";
    const url = new URL("https://discord.com/api/oauth2/authorize");
    url.searchParams.set("client_id", DISCORD_CLIENT_ID);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "identify");
    res.redirect(url.toString());
  });

  // Discord OAuth2: callback, exchange code for user, create session
  app.get("/api/auth/discord/callback", async (req, res) => {
    const { code } = req.query;
    if (!code || !DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !PUBLIC_URL) {
      return res.redirect("/?error=discord_config");
    }
    const redirectUri = PUBLIC_URL.replace(/\/$/, "") + "/api/auth/discord/callback";
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
      const user = await userRes.json();
      const discordId = user.id;
      if (ALLOWED_DISCORD_IDS.length > 0 && !ALLOWED_DISCORD_IDS.includes(discordId)) {
        return res.redirect("/?error=not_allowed");
      }
      const sessionToken = randomBytes(24).toString("hex");
      sessions.add(sessionToken);
      res.setHeader("Set-Cookie", [
        "admin_session=" + sessionToken + "; Path=/; HttpOnly; SameSite=Lax; MaxAge=604800",
      ].join("; "));
      res.redirect("/");
    } catch (e) {
      console.error("Discord OAuth error:", e);
      res.redirect("/?error=discord_failed");
    }
  });

  app.post("/api/login", (req, res) => {
    const password = req.body?.password;
    if (!ADMIN_PASSWORD) return res.status(503).json({ error: "Login not configured (set ADMIN_PASSWORD)" });
    if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: "Wrong password" });
    const token = randomBytes(24).toString("hex");
    sessions.add(token);
    res.setHeader("Set-Cookie", [
      "admin_session=" + token + "; Path=/; HttpOnly; SameSite=Lax; MaxAge=604800",
    ].join("; "));
    res.json({ ok: true });
  });

  app.post("/api/logout", (req, res) => {
    const token = getCookie(req, "admin_session");
    if (token) sessions.delete(token);
    res.setHeader("Set-Cookie", "admin_session=; Path=/; HttpOnly; MaxAge=0");
    res.json({ ok: true });
  });

  app.get("/api/auth/check", (req, res) => {
    if (ADMIN_PASSWORD || apiKey || (DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET)) {
      if (!isAdmin(req)) return res.status(401).json({ ok: false });
    }
    res.json({
      ok: true,
      discordLogin: !!(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET && PUBLIC_URL),
    });
  });

  app.get("/api/auth/config", (req, res) => {
    res.json({
      discordLogin: !!(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET && PUBLIC_URL),
      passwordLogin: !!ADMIN_PASSWORD,
    });
  });

  // All other /api routes require auth (login/logout/auth/check are above and match first)
  app.use("/api", auth);

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
    const { channelId, content, scheduleType } = body;
    if (!channelId || content == null || !scheduleType) {
      return res.status(400).json({
        error: "channelId, content, and scheduleType required (scheduleType: interval_minutes | daily | weekly)",
      });
    }
    const payload = { content: String(content).trim() || " " };
    const options = {
      timezone: body.timezone || "UTC",
      minutes: body.minutes ?? 1,
      time: body.time || "00:00",
      day_of_week: body.day_of_week ?? 0,
    };
    try {
      const { id, label } = addSchedule({
        channelId: String(channelId),
        payload,
        scheduleType,
        options,
      });
      res.json({ ok: true, id, label });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/schedules", async (req, res) => {
    try {
      const list = listSchedules();
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
          return { ...s, serverName, channelName };
        })
      );
      res.json({ schedules: enriched });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/schedules/:id", (req, res) => {
    const id = req.params.id;
    const removed = removeSchedule(id);
    if (!removed) return res.status(404).json({ error: "Schedule not found" });
    res.json({ ok: true });
  });

  return app;
}
