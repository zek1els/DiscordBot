import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { getDb } from "./storage.js";

let _init = false;
function ensureTable() {
  if (_init) return;
  _init = true;
  getDb().exec(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    verified INTEGER DEFAULT 1,
    discord_id TEXT,
    discord_username TEXT,
    created_at TEXT NOT NULL
  )`);
}

const SALT_LEN = 16;
const KEY_LEN = 64;

function hashPassword(password, salt) {
  return scryptSync(password, salt, KEY_LEN).toString("base64");
}

function generateId() {
  return randomBytes(12).toString("hex");
}

function rowToUser(row) {
  if (!row) return null;
  return { id: row.id, email: row.email, verified: !!row.verified, discordId: row.discord_id || undefined, discordUsername: row.discord_username || undefined, createdAt: row.created_at };
}

export function create(email, password, opts = {}) {
  ensureTable();
  const normalized = String(email).trim().toLowerCase();
  if (!normalized) throw new Error("Email required");
  if (!password || password.length < 6) throw new Error("Password must be at least 6 characters");
  const db = getDb();
  const existing = db.prepare("SELECT 1 FROM users WHERE email = ?").get(normalized);
  if (existing) throw new Error("An account with this email already exists");
  const salt = randomBytes(SALT_LEN).toString("base64");
  const passwordHash = hashPassword(password, salt);
  const id = generateId();
  const createdAt = new Date().toISOString();
  db.prepare("INSERT INTO users (id, email, password_hash, salt, verified, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, normalized, passwordHash, salt, opts.verified !== false ? 1 : 0, createdAt);
  return { id, email: normalized, verified: opts.verified !== false };
}

export function validate(email, password) {
  ensureTable();
  const normalized = String(email).trim().toLowerCase();
  const row = getDb().prepare("SELECT * FROM users WHERE email = ?").get(normalized);
  if (!row) return null;
  const hash = hashPassword(password, row.salt);
  try {
    const bufHash = Buffer.from(hash, "base64");
    const bufStored = Buffer.from(row.password_hash, "base64");
    if (bufHash.length !== bufStored.length || !timingSafeEqual(bufHash, bufStored)) return null;
  } catch { return null; }
  return rowToUser(row);
}

export function getByEmail(email) {
  ensureTable();
  return rowToUser(getDb().prepare("SELECT * FROM users WHERE email = ?").get(String(email).trim().toLowerCase()));
}

export function getById(userId) {
  ensureTable();
  return rowToUser(getDb().prepare("SELECT * FROM users WHERE id = ?").get(userId));
}

export function getByDiscordId(discordId) {
  ensureTable();
  return rowToUser(getDb().prepare("SELECT * FROM users WHERE discord_id = ?").get(discordId));
}

export function setDiscord(userId, discordId, discordUsername) {
  ensureTable();
  const changes = getDb().prepare("UPDATE users SET discord_id = ?, discord_username = ? WHERE id = ?").run(discordId, discordUsername || "", userId).changes;
  if (changes === 0) throw new Error("User not found");
}

export function unsetDiscord(userId) {
  ensureTable();
  const changes = getDb().prepare("UPDATE users SET discord_id = NULL, discord_username = NULL WHERE id = ?").run(userId).changes;
  if (changes === 0) throw new Error("User not found");
}

export function listUsers() {
  ensureTable();
  return getDb().prepare("SELECT id, email, verified, discord_id, discord_username, created_at FROM users").all().map((r) => ({
    id: r.id, email: r.email, verified: !!r.verified, discordId: r.discord_id, discordUsername: r.discord_username, createdAt: r.created_at,
  }));
}

export function deleteUser(userId) {
  ensureTable();
  return getDb().prepare("DELETE FROM users WHERE id = ?").run(userId).changes > 0;
}

export function hasAnyUser() {
  ensureTable();
  return !!getDb().prepare("SELECT 1 FROM users LIMIT 1").get();
}
