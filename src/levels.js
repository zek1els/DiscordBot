import { getDb } from "./storage.js";

const XP_PER_MESSAGE = [15, 25];
const XP_COOLDOWN_MS = 60_000;
const BASE_XP = 100;
const XP_MULTIPLIER = 1.5;

const cooldowns = new Map();

let _initialized = false;

function ensureTable() {
  if (_initialized) return;
  _initialized = true;
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS levels (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    xp INTEGER DEFAULT 0,
    total_messages INTEGER DEFAULT 0,
    vc_minutes INTEGER DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS level_role_rewards (
    guild_id TEXT NOT NULL,
    level INTEGER NOT NULL,
    role_id TEXT NOT NULL,
    PRIMARY KEY (guild_id, level)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS level_config (
    guild_id TEXT PRIMARY KEY,
    announce_channel_id TEXT,
    blacklisted_channels TEXT DEFAULT '[]',
    multipliers TEXT DEFAULT '{}'
  )`);
  // Migrate from kv_stores JSON blob if exists
  migrateFromKvStore();
}

function migrateFromKvStore() {
  const db = getDb();
  let row;
  try { row = db.prepare("SELECT value FROM kv_stores WHERE key = ?").get("levels.json"); } catch { return; }
  if (!row) return;
  try {
    const data = JSON.parse(row.value);
    const insert = db.prepare("INSERT OR IGNORE INTO levels (guild_id, user_id, xp, total_messages, vc_minutes) VALUES (?, ?, ?, ?, ?)");
    const txn = db.transaction(() => {
      for (const [guildId, users] of Object.entries(data)) {
        for (const [userId, u] of Object.entries(users)) {
          insert.run(guildId, userId, u.xp || 0, u.totalMessages || 0, u.vcMinutes || 0);
        }
      }
    });
    txn();
    db.prepare("DELETE FROM kv_stores WHERE key = ?").run("levels.json");
    console.log("Migrated levels from kv_stores JSON to SQLite table.");
  } catch (e) {
    console.error("Failed to migrate levels:", e);
  }
}

function xpForLevel(level) {
  return Math.floor(BASE_XP * Math.pow(level, XP_MULTIPLIER));
}

function xpProgressInLevel(xp) {
  let level = 0;
  while (xp >= xpForLevel(level + 1)) {
    xp -= xpForLevel(level + 1);
    level++;
  }
  return { level, currentXp: xp, neededXp: xpForLevel(level + 1) };
}

function levelFromXp(xp) {
  return xpProgressInLevel(xp).level;
}

/**
 * Award XP for a message. Returns { leveledUp, newLevel, roleRewards } if a level-up occurred, null otherwise.
 */
export function awardMessageXp(guildId, userId) {
  ensureTable();
  const db = getDb();
  const key = `${guildId}:${userId}`;
  const now = Date.now();

  // Check cooldown — still count the message even if on cooldown
  if (cooldowns.has(key) && now - cooldowns.get(key) < XP_COOLDOWN_MS) {
    db.prepare("INSERT INTO levels (guild_id, user_id, xp, total_messages, vc_minutes) VALUES (?, ?, 0, 1, 0) ON CONFLICT(guild_id, user_id) DO UPDATE SET total_messages = total_messages + 1")
      .run(guildId, userId);
    return null;
  }
  cooldowns.set(key, now);

  const gain = Math.floor(Math.random() * (XP_PER_MESSAGE[1] - XP_PER_MESSAGE[0] + 1)) + XP_PER_MESSAGE[0];

  // Get old XP for level comparison
  const existing = db.prepare("SELECT xp FROM levels WHERE guild_id = ? AND user_id = ?").get(guildId, userId);
  const oldXp = existing?.xp || 0;
  const oldLevel = levelFromXp(oldXp);

  db.prepare("INSERT INTO levels (guild_id, user_id, xp, total_messages, vc_minutes) VALUES (?, ?, ?, 1, 0) ON CONFLICT(guild_id, user_id) DO UPDATE SET xp = xp + ?, total_messages = total_messages + 1")
    .run(guildId, userId, gain, gain);

  const newLevel = levelFromXp(oldXp + gain);

  if (newLevel > oldLevel) {
    // Check for role rewards between old and new level
    const rewards = db.prepare("SELECT level, role_id FROM level_role_rewards WHERE guild_id = ? AND level > ? AND level <= ? ORDER BY level ASC")
      .all(guildId, oldLevel, newLevel);
    return { leveledUp: true, newLevel, roleRewards: rewards };
  }
  return null;
}

export function addVcMinutes(guildId, userId, minutes) {
  ensureTable();
  const db = getDb();
  db.prepare("INSERT INTO levels (guild_id, user_id, xp, total_messages, vc_minutes) VALUES (?, ?, 0, 0, ?) ON CONFLICT(guild_id, user_id) DO UPDATE SET vc_minutes = vc_minutes + ?")
    .run(guildId, userId, minutes, minutes);
}

export function getStats(guildId, userId) {
  ensureTable();
  const db = getDb();
  const row = db.prepare("SELECT xp, total_messages, vc_minutes FROM levels WHERE guild_id = ? AND user_id = ?").get(guildId, userId);
  if (!row) return { xp: 0, level: 0, currentXp: 0, neededXp: xpForLevel(1), totalMessages: 0, vcMinutes: 0 };
  const progress = xpProgressInLevel(row.xp);
  return {
    xp: row.xp,
    level: progress.level,
    currentXp: progress.currentXp,
    neededXp: progress.neededXp,
    totalMessages: row.total_messages,
    vcMinutes: row.vc_minutes,
  };
}

export function getLeaderboard(guildId, type = "xp", limit = 20) {
  ensureTable();
  const db = getDb();
  const sortCol = type === "messages" ? "total_messages" : type === "vc" ? "vc_minutes" : "xp";
  const rows = db.prepare(`SELECT user_id, xp, total_messages, vc_minutes FROM levels WHERE guild_id = ? ORDER BY ${sortCol} DESC LIMIT ?`).all(guildId, limit);
  return rows.map((r) => ({
    userId: r.user_id,
    xp: r.xp,
    level: levelFromXp(r.xp),
    totalMessages: r.total_messages,
    vcMinutes: r.vc_minutes,
  }));
}

export function getAllGuildStats(guildId) {
  ensureTable();
  const db = getDb();
  const row = db.prepare("SELECT COALESCE(SUM(total_messages), 0) AS totalMessages, COALESCE(SUM(vc_minutes), 0) AS totalVcMinutes, COUNT(*) AS totalUsers FROM levels WHERE guild_id = ?").get(guildId);
  return { totalMessages: row.totalMessages, totalVcMinutes: row.totalVcMinutes, totalUsers: row.totalUsers };
}

// --- Level Role Rewards ---

export function addRoleReward(guildId, level, roleId) {
  ensureTable();
  const db = getDb();
  db.prepare("INSERT OR REPLACE INTO level_role_rewards (guild_id, level, role_id) VALUES (?, ?, ?)").run(guildId, level, roleId);
}

export function removeRoleReward(guildId, level) {
  ensureTable();
  const db = getDb();
  return db.prepare("DELETE FROM level_role_rewards WHERE guild_id = ? AND level = ?").run(guildId, level).changes > 0;
}

export function getRoleRewards(guildId) {
  ensureTable();
  const db = getDb();
  return db.prepare("SELECT level, role_id FROM level_role_rewards WHERE guild_id = ? ORDER BY level ASC").all(guildId);
}

export function getRoleRewardsUpToLevel(guildId, level) {
  ensureTable();
  const db = getDb();
  return db.prepare("SELECT level, role_id FROM level_role_rewards WHERE guild_id = ? AND level <= ? ORDER BY level ASC").all(guildId, level);
}

// --- Level Config ---

export function getLevelConfig(guildId) {
  ensureTable();
  const db = getDb();
  const row = db.prepare("SELECT * FROM level_config WHERE guild_id = ?").get(guildId);
  if (!row) return { announceChannelId: null, blacklistedChannels: [], multipliers: {} };
  return {
    announceChannelId: row.announce_channel_id,
    blacklistedChannels: JSON.parse(row.blacklisted_channels || "[]"),
    multipliers: JSON.parse(row.multipliers || "{}"),
  };
}

export function setLevelConfig(guildId, updates) {
  ensureTable();
  const db = getDb();
  const current = getLevelConfig(guildId);
  const merged = { ...current, ...updates };
  db.prepare("INSERT OR REPLACE INTO level_config (guild_id, announce_channel_id, blacklisted_channels, multipliers) VALUES (?, ?, ?, ?)")
    .run(guildId, merged.announceChannelId, JSON.stringify(merged.blacklistedChannels), JSON.stringify(merged.multipliers));
}
