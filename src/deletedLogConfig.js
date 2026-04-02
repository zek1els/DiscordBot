import { getDb } from "./storage.js";

let _init = false;
function ensureTable() {
  if (_init) return;
  _init = true;
  getDb().exec(`CREATE TABLE IF NOT EXISTS deleted_log_channels (
    channel_id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL
  )`);
}

export function getLogChannelIdsForGuild(guildId) {
  ensureTable();
  return getDb().prepare("SELECT channel_id FROM deleted_log_channels WHERE guild_id = ?").all(guildId).map((r) => r.channel_id);
}

export function addLogChannel(channelId, guildId) {
  ensureTable();
  getDb().prepare("INSERT OR IGNORE INTO deleted_log_channels (channel_id, guild_id) VALUES (?, ?)").run(String(channelId), String(guildId));
}

export function removeLogChannel(channelId) {
  ensureTable();
  return getDb().prepare("DELETE FROM deleted_log_channels WHERE channel_id = ?").run(String(channelId)).changes > 0;
}

export function getAllLogChannels() {
  ensureTable();
  return getDb().prepare("SELECT channel_id AS channelId, guild_id AS guildId FROM deleted_log_channels").all();
}
