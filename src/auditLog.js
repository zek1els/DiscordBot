import { getDb } from "./storage.js";

let _init = false;
function ensureTable() {
  if (_init) return;
  _init = true;
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT DEFAULT '{}',
    timestamp TEXT NOT NULL
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_guild ON audit_log (guild_id, id DESC)`);
}

const MAX_ENTRIES_PER_GUILD = 500;

export function log(guildId, action, details = {}) {
  ensureTable();
  const db = getDb();
  db.prepare("INSERT INTO audit_log (guild_id, action, details, timestamp) VALUES (?, ?, ?, ?)")
    .run(guildId, action, JSON.stringify(details), new Date().toISOString());
  // Trim old entries
  db.prepare(`DELETE FROM audit_log WHERE guild_id = ? AND id NOT IN (SELECT id FROM audit_log WHERE guild_id = ? ORDER BY id DESC LIMIT ?)`)
    .run(guildId, guildId, MAX_ENTRIES_PER_GUILD);
}

export function getLog(guildId, limit = 50) {
  ensureTable();
  const rows = getDb().prepare("SELECT action, details, timestamp FROM audit_log WHERE guild_id = ? ORDER BY id DESC LIMIT ?").all(guildId, limit);
  return rows.map((r) => ({ action: r.action, ...JSON.parse(r.details || "{}"), timestamp: r.timestamp }));
}
