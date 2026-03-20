import Database from "better-sqlite3";
import { existsSync, readFileSync, renameSync, mkdirSync } from "fs";
import { join } from "path";
import { getDataDir } from "./dataDir.js";

let _db = null;

/** Get (or open) the shared SQLite database. */
function getDb() {
  if (_db) return _db;
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  _db = new Database(join(dir, "kova.db"));
  _db.pragma("journal_mode = WAL");
  _db.exec("CREATE TABLE IF NOT EXISTS kv_stores (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  return _db;
}

/** Close the database cleanly on process exit. */
process.on("exit", () => { try { _db?.close(); } catch {} });

/**
 * Create a key-value store backed by SQLite.
 * Drop-in replacement for the old JSON file version — same API.
 * On first access, auto-migrates existing JSON files into the database.
 * @param {string} filename - e.g. "economy.json"
 * @param {() => any} defaultValue - factory for the default (empty) state
 */
export function createStore(filename, defaultValue = () => ({})) {
  let migrated = false;

  /** Migrate old JSON file into SQLite on first access. */
  function migrateFromJson() {
    if (migrated) return;
    migrated = true;
    const db = getDb();
    const existing = db.prepare("SELECT 1 FROM kv_stores WHERE key = ?").get(filename);
    if (existing) return;

    const jsonPath = join(getDataDir(), filename);
    if (existsSync(jsonPath)) {
      try {
        const raw = readFileSync(jsonPath, "utf8");
        JSON.parse(raw); // validate before inserting
        db.prepare("INSERT OR IGNORE INTO kv_stores (key, value) VALUES (?, ?)").run(filename, raw);
        renameSync(jsonPath, jsonPath + ".migrated");
        console.log(`Migrated ${filename} → SQLite`);
      } catch (e) {
        console.error(`Failed to migrate ${filename}:`, e);
      }
    }
  }

  function load() {
    migrateFromJson();
    try {
      const row = getDb().prepare("SELECT value FROM kv_stores WHERE key = ?").get(filename);
      if (row) return JSON.parse(row.value);
    } catch (e) {
      console.error(`Failed to load ${filename}:`, e);
    }
    return defaultValue();
  }

  function save(data) {
    migrateFromJson();
    try {
      getDb().prepare("INSERT OR REPLACE INTO kv_stores (key, value) VALUES (?, ?)")
        .run(filename, JSON.stringify(data));
    } catch (e) {
      console.error(`Failed to save ${filename}:`, e);
    }
  }

  function getPath() {
    return join(getDataDir(), "kova.db");
  }

  function ensureExists() {
    migrateFromJson();
    const db = getDb();
    const existing = db.prepare("SELECT 1 FROM kv_stores WHERE key = ?").get(filename);
    if (!existing) save(defaultValue());
  }

  return { load, save, getPath, ensureExists };
}
