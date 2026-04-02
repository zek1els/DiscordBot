import { getDb } from "./storage.js";

/** @type {import("discord.js").Client | null} */
let _client = null;

/**
 * Set the Discord client reference so analytics can read live presence data.
 * @param {import("discord.js").Client} client
 */
export function setAnalyticsClient(client) {
  _client = client;
}

let _initialized = false;

function ensureTable() {
  if (_initialized) return;
  _initialized = true;
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS analytics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT,
    event TEXT,
    data TEXT,
    timestamp INTEGER
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS analytics_daily (
    guild_id TEXT NOT NULL,
    date TEXT NOT NULL,
    event TEXT NOT NULL,
    count INTEGER DEFAULT 0,
    unique_users INTEGER DEFAULT 0,
    PRIMARY KEY (guild_id, date, event)
  )`);
  // Indexes for common queries
  db.exec(`CREATE INDEX IF NOT EXISTS idx_analytics_guild_event_ts ON analytics (guild_id, event, timestamp)`);
}

/**
 * Aggregate analytics older than 30 days into daily summaries, then delete the raw rows.
 * Should be called on startup.
 */
export function aggregateOldData() {
  try {
    ensureTable();
    const db = getDb();
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

    // Aggregate into daily table
    db.exec(`INSERT OR REPLACE INTO analytics_daily (guild_id, date, event, count, unique_users)
      SELECT guild_id,
             date(timestamp / 1000, 'unixepoch') AS date,
             event,
             COUNT(*) AS count,
             COUNT(DISTINCT json_extract(data, '$.userId')) AS unique_users
      FROM analytics
      WHERE timestamp < ${thirtyDaysAgo}
      GROUP BY guild_id, date, event`);

    // Delete aggregated raw data
    const result = db.prepare("DELETE FROM analytics WHERE timestamp < ?").run(thirtyDaysAgo);
    if (result.changes > 0) {
      console.log(`Analytics: aggregated and cleaned up ${result.changes} old rows.`);
    }
  } catch (e) {
    console.error("Analytics aggregation error:", e);
  }
}

/**
 * Track an analytics event.
 * @param {string} guildId
 * @param {string} event - One of: command_used, message_sent, voice_minute, member_join, member_leave
 * @param {object} data - Arbitrary JSON data for the event
 */
export function trackEvent(guildId, event, data = {}) {
  try {
    ensureTable();
    const db = getDb();
    db.prepare("INSERT INTO analytics (guild_id, event, data, timestamp) VALUES (?, ?, ?, ?)")
      .run(guildId, event, JSON.stringify(data), Date.now());
  } catch (e) {
    console.error("Analytics trackEvent error:", e);
  }
}

/**
 * Get top commands used in the last N days.
 * @param {string} guildId
 * @param {number} days
 * @returns {Array<{ command: string, count: number }>}
 */
export function getCommandStats(guildId, days = 7) {
  try {
    ensureTable();
    const db = getDb();
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const rows = db.prepare(`
      SELECT json_extract(data, '$.command') AS command, COUNT(*) AS count
      FROM analytics
      WHERE guild_id = ? AND event = 'command_used' AND timestamp >= ?
      GROUP BY command
      ORDER BY count DESC
    `).all(guildId, since);
    return rows;
  } catch (e) {
    console.error("Analytics getCommandStats error:", e);
    return [];
  }
}

/**
 * Get messages per day for the last N days.
 * @param {string} guildId
 * @param {number} days
 * @returns {Array<{ date: string, count: number }>}
 */
export function getMessageStats(guildId, days = 7) {
  try {
    ensureTable();
    const db = getDb();
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    // Group by date string (YYYY-MM-DD) derived from timestamp
    const rows = db.prepare(`
      SELECT date(timestamp / 1000, 'unixepoch') AS date, COUNT(*) AS count
      FROM analytics
      WHERE guild_id = ? AND event = 'message_sent' AND timestamp >= ?
      GROUP BY date
      ORDER BY date ASC
    `).all(guildId, since);
    return rows;
  } catch (e) {
    console.error("Analytics getMessageStats error:", e);
    return [];
  }
}

/**
 * Get an activity summary for a guild.
 * @param {string} guildId
 * @returns {{ messagesToday: number, messagesThisWeek: number, commandsToday: number, commandsThisWeek: number, activeUsersToday: number, activeUsersThisWeek: number }}
 */
/**
 * Get member join/leave counts for the last N days.
 */
export function getMemberGrowth(guildId, days = 7) {
  try {
    ensureTable();
    const db = getDb();
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const joins = db.prepare(
      "SELECT COUNT(*) AS count FROM analytics WHERE guild_id = ? AND event = 'member_join' AND timestamp >= ?"
    ).get(guildId, since)?.count || 0;
    const leaves = db.prepare(
      "SELECT COUNT(*) AS count FROM analytics WHERE guild_id = ? AND event = 'member_leave' AND timestamp >= ?"
    ).get(guildId, since)?.count || 0;
    return { joins, leaves, net: joins - leaves };
  } catch (e) {
    console.error("Analytics getMemberGrowth error:", e);
    return { joins: 0, leaves: 0, net: 0 };
  }
}

/**
 * Get peak activity hours (messages grouped by hour of day) for last N days.
 */
export function getPeakHours(guildId, days = 7) {
  try {
    ensureTable();
    const db = getDb();
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const rows = db.prepare(`
      SELECT CAST(strftime('%H', timestamp / 1000, 'unixepoch') AS INTEGER) AS hour, COUNT(*) AS count
      FROM analytics
      WHERE guild_id = ? AND event = 'message_sent' AND timestamp >= ?
      GROUP BY hour
      ORDER BY hour ASC
    `).all(guildId, since);
    // Fill in all 24 hours
    const hourMap = new Map(rows.map((r) => [r.hour, r.count]));
    const result = [];
    for (let h = 0; h < 24; h++) {
      result.push({ hour: h, count: hourMap.get(h) || 0 });
    }
    return result;
  } catch (e) {
    console.error("Analytics getPeakHours error:", e);
    return Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 }));
  }
}

export function getActivitySummary(guildId) {
  try {
    ensureTable();
    const db = getDb();
    const now = Date.now();
    const todayStart = now - 24 * 60 * 60 * 1000;
    const weekStart = now - 7 * 24 * 60 * 60 * 1000;

    const messagesToday = db.prepare(
      "SELECT COUNT(*) AS count FROM analytics WHERE guild_id = ? AND event = 'message_sent' AND timestamp >= ?"
    ).get(guildId, todayStart)?.count || 0;

    const messagesThisWeek = db.prepare(
      "SELECT COUNT(*) AS count FROM analytics WHERE guild_id = ? AND event = 'message_sent' AND timestamp >= ?"
    ).get(guildId, weekStart)?.count || 0;

    const commandsToday = db.prepare(
      "SELECT COUNT(*) AS count FROM analytics WHERE guild_id = ? AND event = 'command_used' AND timestamp >= ?"
    ).get(guildId, todayStart)?.count || 0;

    const commandsThisWeek = db.prepare(
      "SELECT COUNT(*) AS count FROM analytics WHERE guild_id = ? AND event = 'command_used' AND timestamp >= ?"
    ).get(guildId, weekStart)?.count || 0;

    const activeUsersToday = db.prepare(
      "SELECT COUNT(DISTINCT json_extract(data, '$.userId')) AS count FROM analytics WHERE guild_id = ? AND event IN ('message_sent', 'command_used') AND timestamp >= ?"
    ).get(guildId, todayStart)?.count || 0;

    const activeUsersThisWeek = db.prepare(
      "SELECT COUNT(DISTINCT json_extract(data, '$.userId')) AS count FROM analytics WHERE guild_id = ? AND event IN ('message_sent', 'command_used') AND timestamp >= ?"
    ).get(guildId, weekStart)?.count || 0;

    // Live online member count from Discord presence data
    let onlineMembers = 0;
    let totalMembers = 0;
    if (_client) {
      const guild = _client.guilds.cache.get(guildId);
      if (guild) {
        totalMembers = guild.memberCount;
        onlineMembers = guild.members.cache.filter(
          (m) => m.presence?.status && m.presence.status !== "offline"
        ).size;
      }
    }

    return {
      messagesToday,
      messagesThisWeek,
      commandsToday,
      commandsThisWeek,
      activeUsersToday,
      activeUsersThisWeek,
      onlineMembers,
      totalMembers,
    };
  } catch (e) {
    console.error("Analytics getActivitySummary error:", e);
    return {
      messagesToday: 0,
      messagesThisWeek: 0,
      commandsToday: 0,
      commandsThisWeek: 0,
      activeUsersToday: 0,
      activeUsersThisWeek: 0,
      onlineMembers: 0,
      totalMembers: 0,
    };
  }
}
