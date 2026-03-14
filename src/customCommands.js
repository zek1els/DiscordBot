import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { getDataDir } from "./dataDir.js";

const PREFIX = "!";

function getStorePath() {
  return join(getDataDir(), "custom-commands.json");
}

function loadAll() {
  try {
    const path = getStorePath();
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, "utf8"));
    }
  } catch (e) {
    console.error("Failed to load custom commands:", e);
  }
  return [];
}

function saveAll(commands) {
  try {
    const dir = getDataDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(getStorePath(), JSON.stringify(commands, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to save custom commands:", e);
  }
}

/** Command name must be one word, alphanumeric (and maybe hyphen/underscore). */
function normalizeName(name) {
  return String(name).trim().toLowerCase().replace(/\s+/g, "-");
}

/**
 * List all custom commands.
 * @returns {{ name: string, template: string }[]}
 */
export function list() {
  return loadAll();
}

/**
 * Get one custom command by name.
 * @param {string} name
 * @returns {{ name: string, template: string } | null}
 */
export function get(name) {
  const key = normalizeName(name);
  return loadAll().find((c) => normalizeName(c.name) === key) || null;
}

/**
 * Add or update a custom command.
 * @param {string} name - Command name (e.g. "hug")
 * @param {string} template - Response template (e.g. "{author} hugged {target}")
 * @returns {string} Normalized name
 */
export function add(name, template) {
  const key = normalizeName(name);
  if (!key) throw new Error("Command name cannot be empty");
  const commands = loadAll();
  const existing = commands.findIndex((c) => normalizeName(c.name) === key);
  const entry = { name: key, template: String(template ?? "").trim() || " " };
  if (existing >= 0) commands[existing] = entry;
  else commands.push(entry);
  saveAll(commands);
  return key;
}

/**
 * Remove a custom command by name.
 * @param {string} name
 * @returns {boolean}
 */
export function remove(name) {
  const key = normalizeName(name);
  const commands = loadAll().filter((c) => normalizeName(c.name) !== key);
  if (commands.length === loadAll().length) return false;
  saveAll(commands);
  return true;
}

/** Prefix users type (e.g. !hug). */
export function getPrefix() {
  return PREFIX;
}
