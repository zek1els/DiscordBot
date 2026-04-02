import { getDb } from "./storage.js";

let _init = false;
function ensureTable() {
  if (_init) return;
  _init = true;
  getDb().exec(`CREATE TABLE IF NOT EXISTS saved_messages (
    owner_id TEXT NOT NULL DEFAULT '_global',
    name TEXT NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (owner_id, name)
  )`);
}

export function save(name, payload, ownerId = "_global") {
  ensureTable();
  const key = String(name).trim().toLowerCase();
  if (!key) throw new Error("Message name cannot be empty");
  getDb().prepare("INSERT OR REPLACE INTO saved_messages (owner_id, name, payload) VALUES (?, ?, ?)")
    .run(ownerId, key, JSON.stringify(payload));
  return key;
}

export function get(name, ownerId = "_global") {
  ensureTable();
  const key = String(name).trim().toLowerCase();
  const row = getDb().prepare("SELECT payload FROM saved_messages WHERE owner_id = ? AND name = ?").get(ownerId, key);
  if (row) return JSON.parse(row.payload);
  // Fallback to _global if not found under specific owner
  if (ownerId !== "_global") {
    const globalRow = getDb().prepare("SELECT payload FROM saved_messages WHERE owner_id = '_global' AND name = ?").get(key);
    if (globalRow) return JSON.parse(globalRow.payload);
  }
  return null;
}

export function list(ownerId = "_global") {
  ensureTable();
  const rows = getDb().prepare("SELECT name, payload FROM saved_messages WHERE owner_id = ?").all(ownerId);
  return rows.map((r) => {
    const payload = JSON.parse(r.payload);
    const preview = payload?.content?.slice(0, 40) || payload?.embeds?.[0]?.title || payload?.embeds?.[0]?.description || "";
    return { name: r.name, preview: (preview + "\u2026").slice(0, 50) };
  });
}

export function remove(name, ownerId = "_global") {
  ensureTable();
  const key = String(name).trim().toLowerCase();
  return getDb().prepare("DELETE FROM saved_messages WHERE owner_id = ? AND name = ?").run(ownerId, key).changes > 0;
}

export function migrateIfNeeded() {
  // No-op
}
