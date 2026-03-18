import { createStore } from "./storage.js";

const store = createStore("audit-log.json", () => ({}));
const MAX_ENTRIES_PER_GUILD = 500;

/**
 * Log an action.
 * @param {string} guildId
 * @param {"warn"|"jail"|"unjail"|"schedule_create"|"schedule_delete"|"command_add"|"command_delete"|"level_up"|"clear_warnings"} action
 * @param {object} details - { userId, moderatorId, reason, ... }
 */
export function log(guildId, action, details = {}) {
  const data = store.load();
  if (!data[guildId]) data[guildId] = [];
  data[guildId].unshift({
    action,
    ...details,
    timestamp: new Date().toISOString(),
  });
  if (data[guildId].length > MAX_ENTRIES_PER_GUILD) {
    data[guildId] = data[guildId].slice(0, MAX_ENTRIES_PER_GUILD);
  }
  store.save(data);
}

export function getLog(guildId, limit = 50) {
  const data = store.load();
  return (data[guildId] || []).slice(0, limit);
}
