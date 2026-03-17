import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { getDataDir } from "./dataDir.js";

function getStorePath() {
  return join(getDataDir(), "jail-config.json");
}

function loadAll() {
  try {
    const path = getStorePath();
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, "utf8"));
    }
  } catch (e) {
    console.error("Failed to load jail config:", e);
  }
  return {};
}

function saveAll(data) {
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(getStorePath(), JSON.stringify(data, null, 2), "utf8");
}

/**
 * Get jail config for a guild.
 * @param {string} guildId
 * @returns {{ memberRoleId: string, criminalRoleId: string } | null}
 */
export function getConfig(guildId) {
  const all = loadAll();
  return all[guildId] || null;
}

/**
 * Set jail config for a guild.
 * @param {string} guildId
 * @param {string} memberRoleId - Role that grants server access (assigned to everyone)
 * @param {string} criminalRoleId - Role assigned when jailed (member role removed)
 */
export function setConfig(guildId, memberRoleId, criminalRoleId) {
  const all = loadAll();
  all[guildId] = { memberRoleId, criminalRoleId };
  saveAll(all);
}

/**
 * Remove jail config for a guild.
 * @param {string} guildId
 * @returns {boolean}
 */
export function removeConfig(guildId) {
  const all = loadAll();
  if (!(guildId in all)) return false;
  delete all[guildId];
  saveAll(all);
  return true;
}

/**
 * Get all guild configs (for panel).
 * @returns {{ [guildId: string]: { memberRoleId: string, criminalRoleId: string } }}
 */
export function getAllConfigs() {
  return loadAll();
}
