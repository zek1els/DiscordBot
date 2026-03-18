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
  return {};
}

function saveAll(data) {
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(getStorePath(), JSON.stringify(data, null, 2), "utf8");
}

function normalizeName(name) {
  return String(name).trim().toLowerCase().replace(/\s+/g, "-");
}

function getGuildCommands(guildId) {
  const all = loadAll();
  return all[guildId] || [];
}

function setGuildCommands(guildId, commands) {
  const all = loadAll();
  all[guildId] = commands;
  saveAll(all);
}

/**
 * List all custom commands for a guild.
 * @param {string} guildId
 * @returns {{ name: string, template: string }[]}
 */
export function list(guildId) {
  return getGuildCommands(guildId);
}

/**
 * Get one custom command by name for a guild.
 * @param {string} name
 * @param {string} guildId
 * @returns {{ name: string, template: string } | null}
 */
export function get(name, guildId) {
  const key = normalizeName(name);
  return getGuildCommands(guildId).find((c) => normalizeName(c.name) === key) || null;
}

/**
 * Add or update a custom command for a guild.
 * @param {string} name
 * @param {string} template
 * @param {string} guildId
 * @returns {string} Normalized name
 */
export function add(name, template, guildId) {
  const key = normalizeName(name);
  if (!key) throw new Error("Command name cannot be empty");
  if (!guildId) throw new Error("Guild ID required");
  const commands = getGuildCommands(guildId);
  const existing = commands.findIndex((c) => normalizeName(c.name) === key);
  const entry = { name: key, template: String(template ?? "").trim() || " " };
  if (existing >= 0) commands[existing] = entry;
  else commands.push(entry);
  setGuildCommands(guildId, commands);
  return key;
}

/**
 * Remove a custom command by name for a guild.
 * @param {string} name
 * @param {string} guildId
 * @returns {boolean}
 */
export function remove(name, guildId) {
  const key = normalizeName(name);
  const before = getGuildCommands(guildId);
  const after = before.filter((c) => normalizeName(c.name) !== key);
  if (after.length === before.length) return false;
  setGuildCommands(guildId, after);
  return true;
}

/** Prefix users type (e.g. !hug). */
export function getPrefix() {
  return PREFIX;
}

/** Migrate old flat array format to per-guild format. Call once at startup. */
export function migrateIfNeeded() {
  const data = loadAll();
  if (Array.isArray(data) && data.length > 0) {
    const migrated = { _migrated: data };
    saveAll(migrated);
    console.log(`Migrated ${data.length} custom commands from flat array to per-guild format (stored under _migrated — assign to a guild via the panel).`);
  }
}

/** Get total command count across all guilds (for startup log). */
export function totalCount() {
  const all = loadAll();
  return Object.values(all).reduce((sum, cmds) => sum + (Array.isArray(cmds) ? cmds.length : 0), 0);
}
