import { createStore } from "./storage.js";

const store = createStore("economy.json");

function key(guildId, userId) {
  return `${guildId}_${userId}`;
}

const DEFAULT_USER = () => ({
  wallet: 0,
  bank: 0,
  bankLimit: 5000,
  job: null,
  quest: null,
  questProgress: 0,
  inventory: [],
  cooldowns: {},
  stats: { timesWorked: 0, questsCompleted: 0, gamblingWon: 0, gamblingLost: 0, totalEarned: 0 },
});

export function getUser(guildId, userId) {
  const all = store.load();
  const k = key(guildId, userId);
  if (!all[k]) {
    all[k] = DEFAULT_USER();
    store.save(all);
  }
  return { ...all[k] };
}

export function updateUser(guildId, userId, updater) {
  const all = store.load();
  const k = key(guildId, userId);
  if (!all[k]) all[k] = DEFAULT_USER();
  updater(all[k]);
  store.save(all);
  return { ...all[k] };
}

export function addMoney(guildId, userId, amount, toBank = false) {
  return updateUser(guildId, userId, (u) => {
    if (toBank) {
      const space = u.bankLimit - u.bank;
      const deposit = Math.min(amount, space);
      u.bank += deposit;
      u.wallet += amount - deposit;
    } else {
      u.wallet += amount;
    }
    u.stats.totalEarned += amount;
  });
}

export function removeMoney(guildId, userId, amount, fromWallet = true) {
  return updateUser(guildId, userId, (u) => {
    if (fromWallet) u.wallet = Math.max(0, u.wallet - amount);
    else u.bank = Math.max(0, u.bank - amount);
  });
}

export function setCooldown(guildId, userId, action, durationMs) {
  return updateUser(guildId, userId, (u) => {
    u.cooldowns[action] = Date.now() + durationMs;
  });
}

export function getCooldownRemaining(guildId, userId, action) {
  const u = getUser(guildId, userId);
  const expires = u.cooldowns[action] || 0;
  const remaining = expires - Date.now();
  return remaining > 0 ? remaining : 0;
}

export function getLeaderboard(guildId, limit = 10) {
  const all = store.load();
  const prefix = `${guildId}_`;
  return Object.entries(all)
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, v]) => ({ userId: k.slice(prefix.length), total: (v.wallet || 0) + (v.bank || 0) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

// --- Jobs ---

export const JOBS = [
  { id: "dishwasher", name: "Dishwasher", pay: [20, 60], cooldownMs: 30_000, requiredLevel: 0 },
  { id: "janitor", name: "Janitor", pay: [30, 80], cooldownMs: 30_000, requiredLevel: 0 },
  { id: "farmer", name: "Farmer", pay: [40, 100], cooldownMs: 45_000, requiredLevel: 2 },
  { id: "fisher", name: "Fisher", pay: [50, 120], cooldownMs: 45_000, requiredLevel: 3 },
  { id: "chef", name: "Chef", pay: [60, 150], cooldownMs: 60_000, requiredLevel: 5 },
  { id: "teacher", name: "Teacher", pay: [80, 180], cooldownMs: 60_000, requiredLevel: 8 },
  { id: "programmer", name: "Programmer", pay: [100, 250], cooldownMs: 90_000, requiredLevel: 12 },
  { id: "doctor", name: "Doctor", pay: [150, 350], cooldownMs: 120_000, requiredLevel: 18 },
  { id: "ceo", name: "CEO", pay: [250, 600], cooldownMs: 180_000, requiredLevel: 25 },
];

export function getJobLevel(guildId, userId) {
  const u = getUser(guildId, userId);
  return Math.floor(u.stats.timesWorked / 5);
}

// --- Quests ---

export const QUESTS = [
  { id: "work3", description: "Work 3 times", target: 3, reward: 200, track: "timesWorked" },
  { id: "work7", description: "Work 7 times", target: 7, reward: 500, track: "timesWorked" },
  { id: "gamble3", description: "Win 3 gambles", target: 3, reward: 400, track: "gamblingWon" },
  { id: "earn500", description: "Earn 500 coins total", target: 500, reward: 300, track: "totalEarned" },
  { id: "earn2000", description: "Earn 2000 coins total", target: 2000, reward: 800, track: "totalEarned" },
  { id: "quests3", description: "Complete 3 quests", target: 3, reward: 600, track: "questsCompleted" },
];

export function assignRandomQuest(guildId, userId) {
  const quest = QUESTS[Math.floor(Math.random() * QUESTS.length)];
  const u = getUser(guildId, userId);
  const baseline = u.stats[quest.track] || 0;
  return updateUser(guildId, userId, (u) => {
    u.quest = { id: quest.id, baseline };
    u.questProgress = 0;
  });
}

export function checkQuestProgress(guildId, userId) {
  const u = getUser(guildId, userId);
  if (!u.quest) return null;
  const quest = QUESTS.find((q) => q.id === u.quest.id);
  if (!quest) return null;
  const current = (u.stats[quest.track] || 0) - (u.quest.baseline || 0);
  return { quest, current, target: quest.target, done: current >= quest.target };
}

export function completeQuest(guildId, userId) {
  const info = checkQuestProgress(guildId, userId);
  if (!info || !info.done) return null;
  updateUser(guildId, userId, (u) => {
    u.wallet += info.quest.reward;
    u.stats.questsCompleted++;
    u.stats.totalEarned += info.quest.reward;
    u.quest = null;
    u.questProgress = 0;
  });
  return info.quest;
}

// --- Shop items ---

export const SHOP_ITEMS = [
  { id: "padlock", name: "Padlock", price: 500, description: "Protects you from being robbed once" },
  { id: "bank_upgrade", name: "Bank Upgrade", price: 2000, description: "Increases your bank limit by 5000" },
  { id: "lucky_charm", name: "Lucky Charm", price: 1500, description: "Slightly better gambling odds for 10 minutes" },
  { id: "robbers_mask", name: "Robber's Mask", price: 1000, description: "Higher success rate when robbing" },
];

export function buyItem(guildId, userId, itemId) {
  const item = SHOP_ITEMS.find((i) => i.id === itemId);
  if (!item) return { error: "Item not found" };
  const u = getUser(guildId, userId);
  if (u.wallet < item.price) return { error: `You need **${item.price}** coins but only have **${u.wallet}**` };
  updateUser(guildId, userId, (u) => {
    u.wallet -= item.price;
    if (item.id === "bank_upgrade") {
      u.bankLimit = (u.bankLimit || 5000) + 5000;
    } else {
      u.inventory.push({ id: item.id, acquiredAt: Date.now() });
    }
  });
  return { ok: true, item };
}

export function hasItem(guildId, userId, itemId) {
  const u = getUser(guildId, userId);
  return u.inventory.some((i) => i.id === itemId);
}

export function consumeItem(guildId, userId, itemId) {
  return updateUser(guildId, userId, (u) => {
    const idx = u.inventory.findIndex((i) => i.id === itemId);
    if (idx >= 0) u.inventory.splice(idx, 1);
  });
}

export function formatCoins(n) {
  return `**${n.toLocaleString()}** coins`;
}

export function formatCooldown(ms) {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}
