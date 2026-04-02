import { getDb } from "./storage.js";
import { trackEvent } from "./analytics.js";

let _initialized = false;

function ensureTable() {
  if (_initialized) return;
  _initialized = true;
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS offline_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE,
    value TEXT
  )`);
}

/**
 * Get a value from the offline cache KV store.
 */
function getCacheValue(key) {
  ensureTable();
  const db = getDb();
  const row = db.prepare("SELECT value FROM offline_cache WHERE key = ?").get(key);
  return row ? JSON.parse(row.value) : null;
}

/**
 * Set a value in the offline cache KV store.
 */
function setCacheValue(key, value) {
  ensureTable();
  const db = getDb();
  db.prepare("INSERT OR REPLACE INTO offline_cache (key, value) VALUES (?, ?)").run(key, JSON.stringify(value));
}

/**
 * Record the bot's last-seen timestamp (called periodically while online).
 */
export function recordHeartbeat() {
  setCacheValue("last_heartbeat", Date.now());
}

/**
 * Get the last heartbeat timestamp.
 */
export function getLastHeartbeat() {
  return getCacheValue("last_heartbeat") || 0;
}

/**
 * On bot startup, fetch messages sent while the bot was offline and track them in analytics.
 * This scans text channels in all guilds for messages sent between last heartbeat and now.
 * @param {import("discord.js").Client} client
 */
export async function recoverOfflineMessages(client) {
  const lastHeartbeat = getLastHeartbeat();
  if (!lastHeartbeat) {
    console.log("[OfflineCache] No previous heartbeat found — skipping recovery (first run).");
    recordHeartbeat();
    return;
  }

  const downtime = Date.now() - lastHeartbeat;
  // Only recover if bot was down for more than 30 seconds but less than 7 days
  if (downtime < 30_000) {
    console.log("[OfflineCache] Bot was only down for <30s — skipping recovery.");
    recordHeartbeat();
    return;
  }
  if (downtime > 7 * 24 * 60 * 60 * 1000) {
    console.log("[OfflineCache] Bot was down for >7 days — skipping recovery to avoid API spam.");
    recordHeartbeat();
    return;
  }

  const downtimeMin = Math.round(downtime / 60_000);
  console.log(`[OfflineCache] Bot was offline for ~${downtimeMin} minutes. Recovering missed messages...`);

  let totalRecovered = 0;
  const lastHeartbeatDate = new Date(lastHeartbeat);

  for (const [guildId, guild] of client.guilds.cache) {
    const textChannels = guild.channels.cache.filter(
      (ch) => ch.isTextBased() && !ch.isThread() && ch.viewable
    );

    for (const [channelId, channel] of textChannels) {
      try {
        // Fetch messages after the last heartbeat (up to 100 per channel)
        const messages = await channel.messages.fetch({ limit: 100, cache: false });
        const missedMessages = messages.filter(
          (m) => !m.author.bot && m.createdTimestamp > lastHeartbeat
        );

        for (const [, msg] of missedMessages) {
          trackEvent(guildId, "message_sent", {
            userId: msg.author.id,
            channelId: msg.channelId,
            recovered: true,
          });
          totalRecovered++;
        }
      } catch (e) {
        // Skip channels we can't read (permissions, etc.)
        if (e.code !== 50001 && e.code !== 50013) {
          console.warn(`[OfflineCache] Failed to fetch messages from #${channel.name}: ${e.message}`);
        }
      }
    }
  }

  console.log(`[OfflineCache] Recovered ${totalRecovered} missed message(s) from ${downtimeMin}min downtime.`);
  recordHeartbeat();
}

/**
 * Start the heartbeat interval (call once on bot ready).
 * Records a heartbeat every 60 seconds so we know when the bot was last alive.
 */
export function startHeartbeat() {
  recordHeartbeat();
  setInterval(() => {
    recordHeartbeat();
  }, 60_000); // every 60 seconds
}
