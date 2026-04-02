import { getDb } from "./storage.js";

const PREFIX = "!";

let _init = false;
function ensureTable() {
  if (_init) return;
  _init = true;
  getDb().exec(`CREATE TABLE IF NOT EXISTS custom_commands (
    guild_id TEXT NOT NULL,
    name TEXT NOT NULL,
    template TEXT NOT NULL,
    PRIMARY KEY (guild_id, name)
  )`);
}

function normalizeName(name) {
  return String(name).trim().toLowerCase().replace(/\s+/g, "-");
}

export function list(guildId) {
  ensureTable();
  return getDb().prepare("SELECT name, template FROM custom_commands WHERE guild_id = ?").all(guildId);
}

export function get(name, guildId) {
  ensureTable();
  const key = normalizeName(name);
  return getDb().prepare("SELECT name, template FROM custom_commands WHERE guild_id = ? AND name = ?").get(guildId, key) || null;
}

export function add(name, template, guildId) {
  ensureTable();
  const key = normalizeName(name);
  if (!key) throw new Error("Command name cannot be empty");
  if (!guildId) throw new Error("Guild ID required");
  getDb().prepare("INSERT OR REPLACE INTO custom_commands (guild_id, name, template) VALUES (?, ?, ?)")
    .run(guildId, key, String(template ?? "").trim() || " ");
  return key;
}

export function remove(name, guildId) {
  ensureTable();
  const key = normalizeName(name);
  return getDb().prepare("DELETE FROM custom_commands WHERE guild_id = ? AND name = ?").run(guildId, key).changes > 0;
}

export function getPrefix() {
  return PREFIX;
}

export function migrateIfNeeded() {
  // No-op: migration from old format no longer needed
}

export function totalCount() {
  ensureTable();
  return getDb().prepare("SELECT COUNT(*) AS cnt FROM custom_commands").get().cnt;
}
