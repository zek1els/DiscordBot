import { getDb } from "./storage.js";
import { trackEvent } from "./analytics.js";
import { awardMessageXp } from "./levels.js";

let _initialized = false;

function ensureTable() {
  if (_initialized) return;
  _initialized = true;
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS message_cache_status (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT,
    channel_id TEXT,
    oldest_id TEXT,
    total_cached INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    started_at INTEGER,
    finished_at INTEGER,
    UNIQUE(guild_id, channel_id)
  )`);
}

/**
 * Get the caching status for a guild.
 */
export function getCacheStatus(guildId) {
  ensureTable();
  const db = getDb();
  const rows = db.prepare("SELECT * FROM message_cache_status WHERE guild_id = ?").all(guildId);
  const total = rows.reduce((sum, r) => sum + (r.total_cached || 0), 0);
  const pending = rows.filter((r) => r.status === "pending" || r.status === "in_progress").length;
  const done = rows.filter((r) => r.status === "done").length;
  const inProgress = rows.filter((r) => r.status === "in_progress").length;
  return { total, channels: rows.length, pending, done, inProgress, rows };
}

/**
 * Check if a channel has already been fully cached.
 */
function isChannelCached(guildId, channelId) {
  ensureTable();
  const db = getDb();
  const row = db.prepare("SELECT status FROM message_cache_status WHERE guild_id = ? AND channel_id = ?").get(guildId, channelId);
  return row?.status === "done";
}

/**
 * Update channel cache status.
 */
function updateChannelStatus(guildId, channelId, status, totalCached, oldestId = null) {
  ensureTable();
  const db = getDb();
  const now = Date.now();
  db.prepare(`INSERT INTO message_cache_status (guild_id, channel_id, oldest_id, total_cached, status, started_at, finished_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, channel_id) DO UPDATE SET
      oldest_id = COALESCE(?, oldest_id),
      total_cached = ?,
      status = ?,
      finished_at = ?
  `).run(guildId, channelId, oldestId, totalCached, status, now, status === "done" ? now : null,
    oldestId, totalCached, status, status === "done" ? now : null);
}

/**
 * Cache all messages from a single channel into analytics.
 * Pages backwards through the entire channel history.
 * @param {import("discord.js").TextChannel} channel
 * @param {string} guildId
 * @param {(count: number) => void} [onProgress] - Called with running total after each batch
 * @returns {Promise<number>} Total messages cached
 */
async function cacheChannel(channel, guildId, onProgress) {
  let totalCached = 0;
  let beforeId = null;
  const batchSize = 100;

  updateChannelStatus(guildId, channel.id, "in_progress", 0);

  // Use a transaction-style batch insert for performance
  const db = getDb();
  const insertStmt = db.prepare(
    "INSERT INTO analytics (guild_id, event, data, timestamp) VALUES (?, ?, ?, ?)"
  );

  while (true) {
    try {
      const options = { limit: batchSize, cache: false };
      if (beforeId) options.before = beforeId;

      const messages = await channel.messages.fetch(options);
      if (messages.size === 0) break;

      // Batch insert into analytics
      const insertMany = db.transaction((msgs) => {
        for (const msg of msgs) {
          insertStmt.run(
            guildId,
            "message_sent",
            JSON.stringify({
              userId: msg.author.id,
              channelId: channel.id,
              cached: true,
            }),
            msg.createdTimestamp
          );
        }
      });

      const nonBotMessages = messages.filter((m) => !m.author.bot);
      if (nonBotMessages.size > 0) {
        insertMany(Array.from(nonBotMessages.values()));
        totalCached += nonBotMessages.size;
      }

      // Get the oldest message ID for pagination
      const oldest = messages.last();
      beforeId = oldest.id;

      updateChannelStatus(guildId, channel.id, "in_progress", totalCached, beforeId);
      if (onProgress) onProgress(totalCached);

      // If we got fewer than batchSize, we've reached the end
      if (messages.size < batchSize) break;

      // Small delay to avoid rate limits
      await new Promise((r) => setTimeout(r, 500));
    } catch (e) {
      if (e.code === 50001 || e.code === 50013) {
        // Missing access / missing permissions — skip channel
        console.warn(`[MessageCache] Skipping #${channel.name} — no access`);
        break;
      }
      console.error(`[MessageCache] Error fetching from #${channel.name}:`, e.message);
      // Wait and retry once on other errors
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  updateChannelStatus(guildId, channel.id, "done", totalCached, beforeId);
  return totalCached;
}

/**
 * Cache all messages from all text channels in a guild.
 * @param {import("discord.js").Guild} guild
 * @param {(info: { channel: string, channelDone: number, totalDone: number, totalChannels: number }) => void} [onProgress]
 * @returns {Promise<{ totalMessages: number, channelsCached: number, skipped: number }>}
 */
export async function cacheGuild(guild, onProgress) {
  const textChannels = guild.channels.cache.filter(
    (ch) => ch.isTextBased() && !ch.isThread() && !ch.isVoiceBased()
  );

  let totalMessages = 0;
  let channelsCached = 0;
  let skipped = 0;
  const totalChannels = textChannels.size;

  for (const [, channel] of textChannels) {
    // Skip already-cached channels
    if (isChannelCached(guild.id, channel.id)) {
      skipped++;
      if (onProgress) onProgress({
        channel: channel.name,
        channelDone: channelsCached + skipped,
        totalDone: totalMessages,
        totalChannels,
        status: "skipped",
      });
      continue;
    }

    if (!channel.viewable) {
      skipped++;
      continue;
    }

    const count = await cacheChannel(channel, guild.id, (c) => {
      if (onProgress) onProgress({
        channel: channel.name,
        channelDone: channelsCached + skipped,
        totalDone: totalMessages + c,
        totalChannels,
        status: "in_progress",
      });
    });

    totalMessages += count;
    channelsCached++;

    if (onProgress) onProgress({
      channel: channel.name,
      channelDone: channelsCached + skipped,
      totalDone: totalMessages,
      totalChannels,
      status: "done",
    });

    console.log(`[MessageCache] #${channel.name}: ${count} messages cached`);
  }

  console.log(`[MessageCache] Guild "${guild.name}" complete: ${totalMessages} messages from ${channelsCached} channels (${skipped} skipped)`);
  return { totalMessages, channelsCached, skipped };
}

/**
 * Reset cache status for a guild (allows re-caching).
 */
export function resetCacheStatus(guildId) {
  ensureTable();
  const db = getDb();
  db.prepare("DELETE FROM message_cache_status WHERE guild_id = ?").run(guildId);
  // Also remove cached analytics entries for this guild
  db.prepare("DELETE FROM analytics WHERE guild_id = ? AND event = 'message_sent' AND json_extract(data, '$.cached') = 1").run(guildId);
}
