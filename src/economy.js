import { getDb } from "./storage.js";

let _initialized = false;

function ensureTable() {
  if (_initialized) return;
  _initialized = true;
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS economy (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    wallet INTEGER DEFAULT 0,
    bank INTEGER DEFAULT 0,
    bank_limit INTEGER DEFAULT 5000,
    job TEXT,
    quest TEXT,
    quest_baseline INTEGER DEFAULT 0,
    inventory TEXT DEFAULT '[]',
    cooldowns TEXT DEFAULT '{}',
    stats TEXT DEFAULT '{}',
    daily_streak INTEGER DEFAULT 0,
    last_daily INTEGER DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  )`);
  migrateFromKvStore();
}

function migrateFromKvStore() {
  const db = getDb();
  let row;
  try { row = db.prepare("SELECT value FROM kv_stores WHERE key = ?").get("economy.json"); } catch { return; }
  if (!row) return;
  try {
    const data = JSON.parse(row.value);
    const insert = db.prepare(`INSERT OR IGNORE INTO economy
      (guild_id, user_id, wallet, bank, bank_limit, job, quest, quest_baseline, inventory, cooldowns, stats)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const txn = db.transaction(() => {
      for (const [compositeKey, u] of Object.entries(data)) {
        const sepIdx = compositeKey.indexOf("_");
        if (sepIdx === -1) continue;
        const guildId = compositeKey.slice(0, sepIdx);
        const userId = compositeKey.slice(sepIdx + 1);
        const questId = u.quest?.id || null;
        const questBaseline = u.quest?.baseline || 0;
        insert.run(
          guildId, userId,
          u.wallet || 0, u.bank || 0, u.bankLimit || 5000,
          u.job || null, questId, questBaseline,
          JSON.stringify(u.inventory || []),
          JSON.stringify(u.cooldowns || {}),
          JSON.stringify(u.stats || {})
        );
      }
    });
    txn();
    db.prepare("DELETE FROM kv_stores WHERE key = ?").run("economy.json");
    console.log("Migrated economy from kv_stores JSON to SQLite table.");
  } catch (e) {
    console.error("Failed to migrate economy:", e);
  }
}

const DEFAULT_STATS = { timesWorked: 0, questsCompleted: 0, gamblingWon: 0, gamblingLost: 0, totalEarned: 0 };

function rowToUser(row) {
  if (!row) return {
    wallet: 0, bank: 0, bankLimit: 5000, job: null,
    quest: null, questProgress: 0, inventory: [],
    cooldowns: {}, stats: { ...DEFAULT_STATS },
    dailyStreak: 0, lastDaily: 0,
  };
  return {
    wallet: row.wallet,
    bank: row.bank,
    bankLimit: row.bank_limit,
    job: row.job,
    quest: row.quest ? { id: row.quest, baseline: row.quest_baseline } : null,
    questProgress: 0,
    inventory: JSON.parse(row.inventory || "[]"),
    cooldowns: JSON.parse(row.cooldowns || "{}"),
    stats: { ...DEFAULT_STATS, ...JSON.parse(row.stats || "{}") },
    dailyStreak: row.daily_streak || 0,
    lastDaily: row.last_daily || 0,
  };
}

export function getUser(guildId, userId) {
  ensureTable();
  const db = getDb();
  const row = db.prepare("SELECT * FROM economy WHERE guild_id = ? AND user_id = ?").get(guildId, userId);
  if (!row) {
    // Create default user
    db.prepare("INSERT OR IGNORE INTO economy (guild_id, user_id) VALUES (?, ?)").run(guildId, userId);
    return rowToUser(null);
  }
  return rowToUser(row);
}

export function updateUser(guildId, userId, updater) {
  ensureTable();
  const db = getDb();
  // Ensure row exists
  db.prepare("INSERT OR IGNORE INTO economy (guild_id, user_id) VALUES (?, ?)").run(guildId, userId);
  const row = db.prepare("SELECT * FROM economy WHERE guild_id = ? AND user_id = ?").get(guildId, userId);
  const user = rowToUser(row);
  updater(user);
  db.prepare(`UPDATE economy SET
    wallet = ?, bank = ?, bank_limit = ?, job = ?,
    quest = ?, quest_baseline = ?, inventory = ?,
    cooldowns = ?, stats = ?, daily_streak = ?, last_daily = ?
    WHERE guild_id = ? AND user_id = ?`).run(
    user.wallet, user.bank, user.bankLimit, user.job,
    user.quest?.id || null, user.quest?.baseline || 0,
    JSON.stringify(user.inventory),
    JSON.stringify(user.cooldowns),
    JSON.stringify(user.stats),
    user.dailyStreak || 0, user.lastDaily || 0,
    guildId, userId
  );
  return { ...user };
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
  ensureTable();
  const db = getDb();
  const rows = db.prepare("SELECT user_id, wallet, bank FROM economy WHERE guild_id = ? ORDER BY (wallet + bank) DESC LIMIT ?").all(guildId, limit);
  return rows.map((r) => ({ userId: r.user_id, total: r.wallet + r.bank }));
}

// --- Daily Streak ---

export function claimDaily(guildId, userId) {
  ensureTable();
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO economy (guild_id, user_id) VALUES (?, ?)").run(guildId, userId);
  const row = db.prepare("SELECT daily_streak, last_daily FROM economy WHERE guild_id = ? AND user_id = ?").get(guildId, userId);
  const now = Date.now();
  const lastDaily = row?.last_daily || 0;
  let streak = row?.daily_streak || 0;

  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
  const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000;

  // Check if still on cooldown
  if (lastDaily && now - lastDaily < TWENTY_FOUR_HOURS) {
    return { onCooldown: true, remaining: TWENTY_FOUR_HOURS - (now - lastDaily), streak };
  }

  // Check if streak should continue or reset
  if (lastDaily && now - lastDaily < FORTY_EIGHT_HOURS) {
    streak++;
  } else {
    streak = 1;
  }

  // Calculate reward with streak bonus
  const baseAmount = 100 + Math.floor(Math.random() * 201); // 100-300
  const streakBonus = Math.min(streak - 1, 30) * 20; // +20 per streak day, max +600
  const streakMultiplier = streak >= 30 ? 2 : streak >= 14 ? 1.5 : streak >= 7 ? 1.25 : 1;
  const amount = Math.floor((baseAmount + streakBonus) * streakMultiplier);

  return updateUser(guildId, userId, (u) => {
    u.wallet += amount;
    u.stats.totalEarned += amount;
    u.dailyStreak = streak;
    u.lastDaily = now;
    // Attach reward info for the caller
    u._dailyResult = { amount, streak, streakBonus, streakMultiplier, baseAmount };
  });
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
