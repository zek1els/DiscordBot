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

/** Save a named message (template). Overwrites if name exists. */
export function save(name, payload) {
  const key = String(name).trim().toLowerCase();
  if (!key) throw new Error("Message name cannot be empty");
  const data = loadAll();
  data[key] = { name: key, payload };
  saveAll(data);
  return key;
}

/** Get payload for a saved message name. */
export function get(name) {
  const key = String(name).trim().toLowerCase();
  const data = loadAll();
  const entry = data[key];
  return entry ? entry.payload : null;
}

/** List all saved message names with a short preview. */
export function list() {
  const data = loadAll();
  return Object.entries(data).map(([key, { payload }]) => {
    const preview =
      payload.content?.slice(0, 40) ||
      payload.embeds?.[0]?.title ||
      payload.embeds?.[0]?.description ||
      "";
    return { name: key, preview: (preview + "…").slice(0, 50) };
  });
}

/** Remove a saved message by name. */
export function remove(name) {
  const key = String(name).trim().toLowerCase();
  const data = loadAll();
  if (!(key in data)) return false;
  delete data[key];
  saveAll(data);
  return true;
}
