import { createStore } from "./storage.js";
import { randomBytes } from "crypto";

const store = createStore("warnings.json");

export function addWarning(guildId, userId, reason, moderatorId) {
  const data = store.load();
  if (!data[guildId]) data[guildId] = {};
  if (!data[guildId][userId]) data[guildId][userId] = [];
  const warning = {
    id: randomBytes(4).toString("hex"),
    reason,
    moderatorId,
    timestamp: new Date().toISOString(),
  };
  data[guildId][userId].push(warning);
  store.save(data);
  return { warning, total: data[guildId][userId].length };
}

export function getWarnings(guildId, userId) {
  const data = store.load();
  return data[guildId]?.[userId] || [];
}

export function clearWarnings(guildId, userId) {
  const data = store.load();
  if (!data[guildId]?.[userId]) return 0;
  const count = data[guildId][userId].length;
  delete data[guildId][userId];
  store.save(data);
  return count;
}

export function removeWarning(guildId, userId, warningId) {
  const data = store.load();
  const list = data[guildId]?.[userId];
  if (!list) return false;
  const idx = list.findIndex((w) => w.id === warningId);
  if (idx === -1) return false;
  list.splice(idx, 1);
  if (list.length === 0) delete data[guildId][userId];
  store.save(data);
  return true;
}

export function getAllGuildWarnings(guildId) {
  const data = store.load();
  const guild = data[guildId];
  if (!guild) return [];
  const result = [];
  for (const [userId, warnings] of Object.entries(guild)) {
    for (const w of warnings) {
      result.push({ userId, ...w });
    }
  }
  result.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return result;
}
