import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { listUsers, deleteUser } from "../users.js";
import { getDataDir } from "../dataDir.js";

/**
 * Register admin-only routes on the Express app.
 * @param {import("express").Express} app
 * @param {import("discord.js").Client} client
 * @param {object} helpers
 */
export function registerAdminRoutes(app, client, { isAdmin, getCurrentUser, sessions, sessionDelete }) {
  app.get("/api/admin/users", (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin only" });
    try {
      res.json({ users: listUsers() });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/admin/users/:id", (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin only" });
    const userId = req.params.id;
    const currentUser = getCurrentUser(req);
    if (currentUser && currentUser.userId === userId) {
      return res.status(400).json({ error: "Cannot delete your own account" });
    }
    try {
      const deleted = deleteUser(userId);
      if (!deleted) return res.status(404).json({ error: "User not found" });
      for (const [token, session] of sessions) {
        if (session.userId === userId) sessionDelete(token);
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

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

  app.get("/api/debug/data", (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin only" });
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
}
