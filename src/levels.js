import { createStore } from "./storage.js";

const store = createStore("levels.json");

const XP_PER_MESSAGE = [15, 25];
const XP_COOLDOWN_MS = 60_000;
const BASE_XP = 100;
const XP_MULTIPLIER = 1.5;

const cooldowns = new Map();

function xpForLevel(level) {
  return Math.floor(BASE_XP * Math.pow(level, XP_MULTIPLIER));
}

function levelFromXp(xp) {
  let level = 0;
  while (xp >= xpForLevel(level + 1)) {
    xp -= xpForLevel(level + 1);
    level++;
  }
  return level;
}

function xpProgressInLevel(xp) {
  let level = 0;
  while (xp >= xpForLevel(level + 1)) {
    xp -= xpForLevel(level + 1);
    level++;
  }
  return { level, currentXp: xp, neededXp: xpForLevel(level + 1) };
}

function getUser(guildId, userId) {
  const data = store.load();
  return data[guildId]?.[userId] || null;
}

function ensureUser(data, guildId, userId) {
  if (!data[guildId]) data[guildId] = {};
  if (!data[guildId][userId]) {
    data[guildId][userId] = { xp: 0, totalMessages: 0, vcMinutes: 0 };
  }
  return data[guildId][userId];
}

/**
 * Award XP for a message. Returns { leveledUp, newLevel } if a level-up occurred, null otherwise.
 */
export function awardMessageXp(guildId, userId) {
  const key = `${guildId}:${userId}`;
  const now = Date.now();
  if (cooldowns.has(key) && now - cooldowns.get(key) < XP_COOLDOWN_MS) {
    const data = store.load();
    const user = ensureUser(data, guildId, userId);
    user.totalMessages++;
    store.save(data);
    return null;
  }
  cooldowns.set(key, now);

  const data = store.load();
  const user = ensureUser(data, guildId, userId);
  const oldLevel = levelFromXp(user.xp);
  const gain = Math.floor(Math.random() * (XP_PER_MESSAGE[1] - XP_PER_MESSAGE[0] + 1)) + XP_PER_MESSAGE[0];
  user.xp += gain;
  user.totalMessages++;
  const newLevel = levelFromXp(user.xp);
  store.save(data);

  if (newLevel > oldLevel) return { leveledUp: true, newLevel };
  return null;
}

export function addVcMinutes(guildId, userId, minutes) {
  const data = store.load();
  const user = ensureUser(data, guildId, userId);
  user.vcMinutes += minutes;
  store.save(data);
}

export function getStats(guildId, userId) {
  const user = getUser(guildId, userId);
  if (!user) return { xp: 0, level: 0, currentXp: 0, neededXp: xpForLevel(1), totalMessages: 0, vcMinutes: 0 };
  const progress = xpProgressInLevel(user.xp);
  return {
    xp: user.xp,
    level: progress.level,
    currentXp: progress.currentXp,
    neededXp: progress.neededXp,
    totalMessages: user.totalMessages || 0,
    vcMinutes: user.vcMinutes || 0,
  };
}

export function getLeaderboard(guildId, type = "xp", limit = 20) {
  const data = store.load();
  const guild = data[guildId];
  if (!guild) return [];

  const entries = Object.entries(guild).map(([userId, u]) => ({
    userId,
    xp: u.xp || 0,
    level: levelFromXp(u.xp || 0),
    totalMessages: u.totalMessages || 0,
    vcMinutes: u.vcMinutes || 0,
  }));

  const sortKey = type === "messages" ? "totalMessages" : type === "vc" ? "vcMinutes" : "xp";
  entries.sort((a, b) => b[sortKey] - a[sortKey]);
  return entries.slice(0, limit);
}

export function getAllGuildStats(guildId) {
  const data = store.load();
  const guild = data[guildId];
  if (!guild) return { totalMessages: 0, totalVcMinutes: 0, totalUsers: 0 };
  let totalMessages = 0, totalVcMinutes = 0;
  const userIds = Object.keys(guild);
  for (const u of Object.values(guild)) {
    totalMessages += u.totalMessages || 0;
    totalVcMinutes += u.vcMinutes || 0;
  }
  return { totalMessages, totalVcMinutes, totalUsers: userIds.length };
}
