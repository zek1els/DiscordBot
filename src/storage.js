import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { getDataDir } from "./dataDir.js";

let _db = null;

/** Get (or open) the shared SQLite database. */
export function getDb() {
  if (_db) return _db;
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  _db = new Database(join(dir, "kova.db"));
  _db.pragma("journal_mode = WAL");
  return _db;
}

/** Close the database cleanly on process exit. */
process.on("exit", () => { try { _db?.close(); } catch {} });
