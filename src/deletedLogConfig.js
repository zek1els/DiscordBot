import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { getDataDir } from "./dataDir.js";

function getConfigPath() {
  return join(getDataDir(), "deleted-log-config.json");
}

/**
 * Load config: { channels: [ { channelId, guildId } ] }
 * Channels where /log-deletes here was run; logs are sent to these channels (per guild).
 */
function load() {
  try {
    const path = getConfigPath();
    if (existsSync(path)) {
      const config = JSON.parse(readFileSync(path, "utf8"));
      if (config.channels) return config;
      if (config.guilds && typeof config.guilds === "object") {
        const channels = Object.entries(config.guilds).map(([guildId, channelId]) => ({ channelId, guildId }));
        return { channels };
      }
    }
  } catch (e) {
    console.error("Failed to load deleted-log config:", e);
  }
  return { channels: [] };
}

function save(config) {
  try {
    const dir = getDataDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to save deleted-log config:", e);
  }
}

/**
 * Get channel IDs where the bot should post deletion logs for a guild (channels that ran /log-deletes here in that guild).
 * @param {string} guildId
 * @returns {string[]}
 */
export function getLogChannelIdsForGuild(guildId) {
  const config = load();
  const list = config.channels || [];
  return list.filter((c) => c.guildId === guildId).map((c) => c.channelId);
}

/**
 * Register a channel to receive deleted message logs (run /log-deletes here in that channel).
 */
export function addLogChannel(channelId, guildId) {
  const config = load();
  if (!config.channels) config.channels = [];
  const id = String(channelId);
  if (config.channels.some((c) => c.channelId === id && c.guildId === String(guildId))) return;
  config.channels.push({ channelId: id, guildId: String(guildId) });
  save(config);
}

/**
 * Unregister a channel from receiving logs.
 */
export function removeLogChannel(channelId) {
  const config = load();
  if (!config.channels) return false;
  const id = String(channelId);
  const before = config.channels.length;
  config.channels = config.channels.filter((c) => c.channelId !== id);
  if (config.channels.length === before) return false;
  save(config);
  return true;
}

/**
 * Get all registered channels for the panel. [{ channelId, guildId }]
 */
export function getAllLogChannels() {
  const config = load();
  return Array.isArray(config.channels) ? [...config.channels] : [];
}
