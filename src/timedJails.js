import { getDb } from "./storage.js";
import { getConfig as getJailConfig, popJailedRoles } from "./jailConfig.js";
import { log as auditLog } from "./auditLog.js";
import { sendModLog } from "./modLog.js";
import { safeTimeout } from "./safeTimeout.js";
import { formatMs } from "./reminders.js";

let _initialized = false;
const activeTimers = new Map();

function ensureTable() {
  if (_initialized) return;
  _initialized = true;
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS timed_jails (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    channel_id TEXT,
    unjail_at INTEGER NOT NULL,
    duration_label TEXT,
    PRIMARY KEY (guild_id, user_id)
  )`);
}

/**
 * Save a timed jail to the database and start the timer.
 */
export function addTimedJail(client, guild, userId, channelId, durationMs, durationLabel) {
  ensureTable();
  const db = getDb();
  const unjailAt = Date.now() + durationMs;
  db.prepare("INSERT OR REPLACE INTO timed_jails (guild_id, user_id, channel_id, unjail_at, duration_label) VALUES (?, ?, ?, ?, ?)")
    .run(guild.id, userId, channelId, unjailAt, durationLabel);

  startUnjailTimer(client, guild, userId, channelId, durationMs, durationLabel);
}

/**
 * Remove a timed jail (on manual unjail).
 */
export function removeTimedJail(guildId, userId) {
  ensureTable();
  const db = getDb();
  db.prepare("DELETE FROM timed_jails WHERE guild_id = ? AND user_id = ?").run(guildId, userId);
  const key = `${guildId}:${userId}`;
  if (activeTimers.has(key)) {
    activeTimers.get(key).clear();
    activeTimers.delete(key);
  }
}

/**
 * Restore all timed jails on bot startup.
 */
export function restoreTimedJails(client) {
  ensureTable();
  const db = getDb();
  const rows = db.prepare("SELECT * FROM timed_jails").all();
  const now = Date.now();
  let restored = 0;
  let expired = 0;

  for (const row of rows) {
    const remaining = row.unjail_at - now;
    const guild = client.guilds.cache.get(row.guild_id);
    if (!guild) {
      // Guild no longer accessible, clean up
      db.prepare("DELETE FROM timed_jails WHERE guild_id = ? AND user_id = ?").run(row.guild_id, row.user_id);
      continue;
    }

    if (remaining <= 0) {
      // Already expired, unjail immediately
      expired++;
      performUnjail(client, guild, row.user_id, row.channel_id, row.duration_label);
      db.prepare("DELETE FROM timed_jails WHERE guild_id = ? AND user_id = ?").run(row.guild_id, row.user_id);
    } else {
      restored++;
      startUnjailTimer(client, guild, row.user_id, row.channel_id, remaining, row.duration_label);
    }
  }

  if (restored > 0 || expired > 0) {
    console.log(`Timed jails: restored ${restored} timer(s), processed ${expired} expired jail(s).`);
  }
}

function startUnjailTimer(client, guild, userId, channelId, delayMs, durationLabel) {
  const key = `${guild.id}:${userId}`;
  if (activeTimers.has(key)) {
    activeTimers.get(key).clear();
  }

  const handle = safeTimeout(async () => {
    activeTimers.delete(key);
    await performUnjail(client, guild, userId, channelId, durationLabel);
    const db = getDb();
    db.prepare("DELETE FROM timed_jails WHERE guild_id = ? AND user_id = ?").run(guild.id, userId);
  }, delayMs);

  activeTimers.set(key, handle);
}

async function performUnjail(client, guild, userId, channelId, durationLabel) {
  const cfg = getJailConfig(guild.id);
  if (!cfg) return;

  try {
    const member = await guild.members.fetch(userId);
    if (cfg.criminalRoleId) await member.roles.remove(cfg.criminalRoleId);
    const saved = popJailedRoles(guild.id, userId);
    if (saved && saved.length > 0) await member.roles.add(saved);
    else if (cfg.memberRoleId) await member.roles.add(cfg.memberRoleId);

    // Notify in channel if possible
    if (channelId) {
      const channel = guild.channels.cache.get(channelId);
      if (channel) {
        channel.send({
          embeds: [{ color: 0x57f287, description: `\ud83d\udd13 <@${userId}> has been automatically unjailed (${durationLabel || "timer"} elapsed).` }],
        }).catch(() => {});
      }
    }

    auditLog(guild.id, "unjail", { userId, moderatorId: "auto-timer" });
    sendModLog(client, guild.id, "unjail", { userId, moderatorId: "auto-timer", reason: `Auto-unjail after ${durationLabel || "timer"}` });
  } catch (e) {
    console.error(`Auto-unjail failed for ${userId} in ${guild.name}:`, e.message);
  }
}

export function hasActiveTimer(guildId, userId) {
  return activeTimers.has(`${guildId}:${userId}`);
}
