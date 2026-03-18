import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { getDataDir } from "./dataDir.js";

/**
 * Create a JSON file store with load/save helpers.
 * Eliminates the repeated boilerplate across data modules.
 * @param {string} filename - e.g. "economy.json"
 * @param {() => any} defaultValue - factory for the default (empty) state
 */
export function createStore(filename, defaultValue = () => ({})) {
  const getPath = () => join(getDataDir(), filename);

  function load() {
    try {
      const p = getPath();
      if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
    } catch (e) {
      console.error(`Failed to load ${filename}:`, e);
    }
    return defaultValue();
  }

  function save(data) {
    try {
      const dir = getDataDir();
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(getPath(), JSON.stringify(data, null, 2), "utf8");
    } catch (e) {
      console.error(`Failed to save ${filename}:`, e);
    }
  }

  function ensureExists() {
    const dir = getDataDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const p = getPath();
    if (!existsSync(p)) save(defaultValue());
  }

  return { load, save, getPath, ensureExists };
}
