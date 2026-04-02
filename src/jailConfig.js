import { getDb } from "./storage.js";

let _init = false;
function ensureTable() {
  if (_init) return;
  _init = true;
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS jail_config (
    guild_id TEXT PRIMARY KEY,
    member_role_id TEXT,
    criminal_role_id TEXT,
    allowed_role_ids TEXT DEFAULT '[]'
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS jailed_users (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role_ids TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY (guild_id, user_id)
  )`);
}

export function getConfig(guildId) {
  ensureTable();
  const row = getDb().prepare("SELECT * FROM jail_config WHERE guild_id = ?").get(guildId);
  if (!row) return null;
  return { memberRoleId: row.member_role_id, criminalRoleId: row.criminal_role_id, allowedRoleIds: JSON.parse(row.allowed_role_ids || "[]") };
}

export function setConfig(guildId, memberRoleId, criminalRoleId, allowedRoleIds = []) {
  ensureTable();
  getDb().prepare("INSERT OR REPLACE INTO jail_config (guild_id, member_role_id, criminal_role_id, allowed_role_ids) VALUES (?, ?, ?, ?)")
    .run(guildId, memberRoleId, criminalRoleId, JSON.stringify(allowedRoleIds));
}

export function removeConfig(guildId) {
  ensureTable();
  return getDb().prepare("DELETE FROM jail_config WHERE guild_id = ?").run(guildId).changes > 0;
}

export function getAllConfigs() {
  ensureTable();
  const rows = getDb().prepare("SELECT * FROM jail_config").all();
  const result = {};
  for (const row of rows) {
    result[row.guild_id] = { memberRoleId: row.member_role_id, criminalRoleId: row.criminal_role_id, allowedRoleIds: JSON.parse(row.allowed_role_ids || "[]") };
  }
  return result;
}

export function saveJailedRoles(guildId, userId, roleIds) {
  ensureTable();
  getDb().prepare("INSERT OR REPLACE INTO jailed_users (guild_id, user_id, role_ids) VALUES (?, ?, ?)").run(guildId, userId, JSON.stringify(roleIds));
}

export function popJailedRoles(guildId, userId) {
  ensureTable();
  const row = getDb().prepare("SELECT role_ids FROM jailed_users WHERE guild_id = ? AND user_id = ?").get(guildId, userId);
  if (!row) return null;
  getDb().prepare("DELETE FROM jailed_users WHERE guild_id = ? AND user_id = ?").run(guildId, userId);
  return JSON.parse(row.role_ids);
}
