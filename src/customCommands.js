import { createStore } from "./storage.js";

const PREFIX = "!";
const store = createStore("custom-commands.json");

function normalizeName(name) {
  return String(name).trim().toLowerCase().replace(/\s+/g, "-");
}

function getGuildCommands(guildId) {
  return store.load()[guildId] || [];
}

function setGuildCommands(guildId, commands) {
  const all = store.load();
  all[guildId] = commands;
  store.save(all);
}

export function list(guildId) {
  return getGuildCommands(guildId);
}

export function get(name, guildId) {
  const key = normalizeName(name);
  return getGuildCommands(guildId).find((c) => normalizeName(c.name) === key) || null;
}

export function add(name, template, guildId) {
  const key = normalizeName(name);
  if (!key) throw new Error("Command name cannot be empty");
  if (!guildId) throw new Error("Guild ID required");
  const commands = getGuildCommands(guildId);
  const existing = commands.findIndex((c) => normalizeName(c.name) === key);
  const entry = { name: key, template: String(template ?? "").trim() || " " };
  if (existing >= 0) commands[existing] = entry;
  else commands.push(entry);
  setGuildCommands(guildId, commands);
  return key;
}

export function remove(name, guildId) {
  const key = normalizeName(name);
  const before = getGuildCommands(guildId);
  const after = before.filter((c) => normalizeName(c.name) !== key);
  if (after.length === before.length) return false;
  setGuildCommands(guildId, after);
  return true;
}

export function getPrefix() {
  return PREFIX;
}

export function migrateIfNeeded() {
  const data = store.load();
  if (Array.isArray(data) && data.length > 0) {
    store.save({ _migrated: data });
    console.log(`Migrated ${data.length} custom commands from flat array to per-guild format (stored under _migrated).`);
  }
}

export function totalCount() {
  const all = store.load();
  return Object.values(all).reduce((sum, cmds) => sum + (Array.isArray(cmds) ? cmds.length : 0), 0);
}
