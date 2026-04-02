import { getDb } from "./storage.js";
import { randomBytes } from "crypto";

let _init = false;
function ensureTable() {
  if (_init) return;
  _init = true;
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS warnings (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    reason TEXT,
    moderator_id TEXT,
    timestamp TEXT NOT NULL
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_warnings_guild_user ON warnings (guild_id, user_id)`);
}

export function addWarning(guildId, userId, reason, moderatorId) {
  ensureTable();
  const db = getDb();
  const warning = {
    id: randomBytes(4).toString("hex"),
    reason,
    moderatorId,
    timestamp: new Date().toISOString(),
  };
  db.prepare("INSERT INTO warnings (id, guild_id, user_id, reason, moderator_id, timestamp) VALUES (?, ?, ?, ?, ?, ?)")
    .run(warning.id, guildId, userId, reason, moderatorId, warning.timestamp);
  const total = db.prepare("SELECT COUNT(*) AS cnt FROM warnings WHERE guild_id = ? AND user_id = ?").get(guildId, userId).cnt;
  return { warning, total };
}

export function getWarnings(guildId, userId) {
  ensureTable();
  return getDb().prepare("SELECT id, reason, moderator_id AS moderatorId, timestamp FROM warnings WHERE guild_id = ? AND user_id = ? ORDER BY rowid ASC").all(guildId, userId);
}

export function clearWarnings(guildId, userId) {
  ensureTable();
  return getDb().prepare("DELETE FROM warnings WHERE guild_id = ? AND user_id = ?").run(guildId, userId).changes;
}

export function removeWarning(guildId, userId, warningId) {
  ensureTable();
  return getDb().prepare("DELETE FROM warnings WHERE id = ? AND guild_id = ? AND user_id = ?").run(warningId, guildId, userId).changes > 0;
}

export function getAllGuildWarnings(guildId) {
  ensureTable();
  return getDb().prepare("SELECT id, user_id AS userId, reason, moderator_id AS moderatorId, timestamp FROM warnings WHERE guild_id = ? ORDER BY rowid DESC").all(guildId);
}
