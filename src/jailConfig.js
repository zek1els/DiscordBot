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
 * @param {string[]} [allowedRoleIds] - Roles allowed to use !jail/!unjail (empty = Manage Roles perm required)
 */
export function setConfig(guildId, memberRoleId, criminalRoleId, allowedRoleIds = []) {
  const all = loadAll();
  all[guildId] = { memberRoleId, criminalRoleId, allowedRoleIds };
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

// --- Jailed-user role storage (saves roles stripped on jail so unjail can restore them) ---

function getJailedStorePath() {
  return join(getDataDir(), "jailed-users.json");
}

function loadJailed() {
  try {
    const p = getJailedStorePath();
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    console.error("Failed to load jailed users:", e);
  }
  return {};
}

function saveJailed(data) {
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(getJailedStorePath(), JSON.stringify(data, null, 2), "utf8");
}

/**
 * Save the roles a user had before being jailed.
 * @param {string} guildId
 * @param {string} userId
 * @param {string[]} roleIds
 */
export function saveJailedRoles(guildId, userId, roleIds) {
  const all = loadJailed();
  if (!all[guildId]) all[guildId] = {};
  all[guildId][userId] = roleIds;
  saveJailed(all);
}

/**
 * Get and remove the saved roles for a jailed user (consumed on unjail).
 * @param {string} guildId
 * @param {string} userId
 * @returns {string[] | null}
 */
export function popJailedRoles(guildId, userId) {
  const all = loadJailed();
  const roles = all[guildId]?.[userId] ?? null;
  if (roles) {
    delete all[guildId][userId];
    if (Object.keys(all[guildId]).length === 0) delete all[guildId];
    saveJailed(all);
  }
  return roles;
}
