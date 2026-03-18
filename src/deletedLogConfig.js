import { createStore } from "./storage.js";

const store = createStore("deleted-log-config.json", () => ({ channels: [] }));

function load() {
  const config = store.load();
  if (config.channels) return config;
  // Migrate old { guilds: { guildId: channelId } } format
  if (config.guilds && typeof config.guilds === "object") {
    const channels = Object.entries(config.guilds).map(([guildId, channelId]) => ({ channelId, guildId }));
    return { channels };
  }
  return { channels: [] };
}

export function getLogChannelIdsForGuild(guildId) {
  const list = load().channels || [];
  return list.filter((c) => c.guildId === guildId).map((c) => c.channelId);
}

export function addLogChannel(channelId, guildId) {
  const config = load();
  if (!config.channels) config.channels = [];
  const id = String(channelId);
  if (config.channels.some((c) => c.channelId === id && c.guildId === String(guildId))) return;
  config.channels.push({ channelId: id, guildId: String(guildId) });
  store.save(config);
}

export function removeLogChannel(channelId) {
  const config = load();
  if (!config.channels) return false;
  const id = String(channelId);
  const before = config.channels.length;
  config.channels = config.channels.filter((c) => c.channelId !== id);
  if (config.channels.length === before) return false;
  store.save(config);
  return true;
}

export function getAllLogChannels() {
  const config = load();
  return Array.isArray(config.channels) ? [...config.channels] : [];
}
