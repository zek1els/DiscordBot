import { getDb } from "./storage.js";

let _init = false;
function ensureTable() {
  if (_init) return;
  _init = true;
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS confession_config (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS confession_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT,
    confession_number INTEGER,
    user_id TEXT,
    text TEXT,
    timestamp INTEGER
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_conflog_guild ON confession_log (guild_id, timestamp DESC)`);
  // Add user_id column if missing (migration)
  try {
    const cols = db.prepare("PRAGMA table_info(confession_log)").all().map((c) => c.name);
    if (!cols.includes("user_id")) {
      db.exec("ALTER TABLE confession_log ADD COLUMN user_id TEXT");
    }
  } catch {}
}

export function getConfessionConfig(guildId) {
  ensureTable();
  const row = getDb().prepare("SELECT channel_id FROM confession_config WHERE guild_id = ?").get(guildId);
  return row ? { channelId: row.channel_id } : null;
}

export function setConfessionChannel(guildId, channelId) {
  ensureTable();
  getDb().prepare("INSERT OR REPLACE INTO confession_config (guild_id, channel_id) VALUES (?, ?)").run(guildId, channelId);
}

export function disableConfessions(guildId) {
  ensureTable();
  getDb().prepare("DELETE FROM confession_config WHERE guild_id = ?").run(guildId);
}

export async function postConfession(client, guildId, text, userId = null) {
  const cfg = getConfessionConfig(guildId);
  if (!cfg) return { ok: false, error: "Confessions are not set up. An admin must run `/confess-setup`." };

  const channel = await client.channels.fetch(cfg.channelId).catch(() => null);
  if (!channel) return { ok: false, error: "Confession channel not found. Ask an admin to reconfigure." };

  ensureTable();
  const db = getDb();
  const lastNum = db.prepare("SELECT MAX(confession_number) AS n FROM confession_log WHERE guild_id = ?").get(guildId)?.n || 0;
  const count = lastNum + 1;

  await channel.send({
    embeds: [{
      color: 0x2f3136,
      author: { name: `Anonymous Confession #${count}` },
      description: text,
      footer: { text: "Use /confess to submit your own" },
      timestamp: new Date().toISOString(),
    }],
  });

  try {
    db.prepare("INSERT INTO confession_log (guild_id, confession_number, user_id, text, timestamp) VALUES (?, ?, ?, ?, ?)").run(guildId, count, userId, text, Date.now());
  } catch {}

  return { ok: true };
}

export function getConfessionHistory(guildId, { page = 1, limit = 50 } = {}) {
  try {
    ensureTable();
    const db = getDb();
    const offset = (page - 1) * limit;
    const rows = db.prepare("SELECT * FROM confession_log WHERE guild_id = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?").all(guildId, limit, offset);
    const total = db.prepare("SELECT COUNT(*) AS cnt FROM confession_log WHERE guild_id = ?").get(guildId)?.cnt || 0;
    return { confessions: rows, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) };
  } catch {
    return { confessions: [], total: 0, page: 1, totalPages: 1 };
  }
}
