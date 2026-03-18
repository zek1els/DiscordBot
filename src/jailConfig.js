import { createStore } from "./storage.js";

const configStore = createStore("jail-config.json");
const jailedStore = createStore("jailed-users.json");

export function getConfig(guildId) {
  return configStore.load()[guildId] || null;
}

export function setConfig(guildId, memberRoleId, criminalRoleId, allowedRoleIds = []) {
  const all = configStore.load();
  all[guildId] = { memberRoleId, criminalRoleId, allowedRoleIds };
  configStore.save(all);
}

export function removeConfig(guildId) {
  const all = configStore.load();
  if (!(guildId in all)) return false;
  delete all[guildId];
  configStore.save(all);
  return true;
}

export function getAllConfigs() {
  return configStore.load();
}

export function saveJailedRoles(guildId, userId, roleIds) {
  const all = jailedStore.load();
  if (!all[guildId]) all[guildId] = {};
  all[guildId][userId] = roleIds;
  jailedStore.save(all);
}

export function popJailedRoles(guildId, userId) {
  const all = jailedStore.load();
  const roles = all[guildId]?.[userId] ?? null;
  if (roles) {
    delete all[guildId][userId];
    if (Object.keys(all[guildId]).length === 0) delete all[guildId];
    jailedStore.save(all);
  }
  return roles;
}
