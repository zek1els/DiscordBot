import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { getDataDir } from "./dataDir.js";

function getStorePath() {
  return join(getDataDir(), "saved-messages.json");
}

function loadAll() {
  try {
    const path = getStorePath();
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, "utf8"));
    }
  } catch (e) {
    console.error("Failed to load saved messages:", e);
  }
  return {};
}

function saveAll(data) {
  try {
    const dir = getDataDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(getStorePath(), JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to save messages:", e);
  }
}

function getUserBucket(data, ownerId) {
  return data[ownerId] || {};
}

/** Save a named message (template) for a specific owner. Overwrites if name exists. */
export function save(name, payload, ownerId = "_global") {
  const key = String(name).trim().toLowerCase();
  if (!key) throw new Error("Message name cannot be empty");
  const data = loadAll();
  if (!data[ownerId]) data[ownerId] = {};
  data[ownerId][key] = { name: key, payload };
  saveAll(data);
  return key;
}

/** Get payload for a saved message name. Checks owner first, then _global fallback. */
export function get(name, ownerId = "_global") {
  const key = String(name).trim().toLowerCase();
  const data = loadAll();
  const userEntry = getUserBucket(data, ownerId)[key];
  if (userEntry) return userEntry.payload;
  if (ownerId !== "_global") {
    const globalEntry = getUserBucket(data, "_global")[key];
    if (globalEntry) return globalEntry.payload;
  }
  return null;
}

/** List saved message names for an owner (with short previews). */
export function list(ownerId = "_global") {
  const data = loadAll();
  const bucket = getUserBucket(data, ownerId);
  return Object.entries(bucket).map(([key, { payload }]) => {
    const preview =
      payload?.content?.slice(0, 40) ||
      payload?.embeds?.[0]?.title ||
      payload?.embeds?.[0]?.description ||
      "";
    return { name: key, preview: (preview + "…").slice(0, 50) };
  });
}

/** Remove a saved message by name for a specific owner. */
export function remove(name, ownerId = "_global") {
  const key = String(name).trim().toLowerCase();
  const data = loadAll();
  const bucket = data[ownerId];
  if (!bucket || !(key in bucket)) return false;
  delete bucket[key];
  if (Object.keys(bucket).length === 0) delete data[ownerId];
  saveAll(data);
  return true;
}

/** Migrate old flat format { name: { name, payload } } to new format { _global: { name: { name, payload } } } */
export function migrateIfNeeded() {
  const data = loadAll();
  const keys = Object.keys(data);
  if (keys.length === 0) return;
  const firstVal = data[keys[0]];
  if (firstVal && firstVal.payload !== undefined && firstVal.name !== undefined) {
    const migrated = { _global: { ...data } };
    saveAll(migrated);
    console.log(`Migrated ${keys.length} saved messages to new per-user format.`);
  }
}
