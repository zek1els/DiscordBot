import { getDb } from "./storage.js";
import { sendModLog } from "./modLog.js";

let _init = false;
function ensureTable() {
  if (_init) return;
  _init = true;
  getDb().exec(`CREATE TABLE IF NOT EXISTS automod_config (
    guild_id TEXT PRIMARY KEY,
    config TEXT NOT NULL DEFAULT '{}'
  )`);
}

// In-memory spam tracking: Map<"guildId:userId", number[]>
const spamTracker = new Map();

const DEFAULT_CONFIG = {
  enabled: false,
  spamFilter: { enabled: false, maxMessages: 5, interval: 5000, action: "mute" },
  linkFilter: { enabled: false, whitelist: [], action: "delete" },
  wordFilter: { enabled: false, words: [], action: "delete" },
  capsFilter: { enabled: false, threshold: 70, minLength: 10, action: "delete" },
};

export function getAutomodConfig(guildId) {
  ensureTable();
  const row = getDb().prepare("SELECT config FROM automod_config WHERE guild_id = ?").get(guildId);
  if (!row) return { ...DEFAULT_CONFIG };
  return { ...DEFAULT_CONFIG, ...JSON.parse(row.config) };
}

export function setAutomodConfig(guildId, config) {
  ensureTable();
  const merged = { ...getAutomodConfig(guildId), ...config };
  getDb().prepare("INSERT OR REPLACE INTO automod_config (guild_id, config) VALUES (?, ?)").run(guildId, JSON.stringify(merged));
}

const URL_REGEX = /https?:\/\/[^\s<]+/gi;

export function checkMessage(message) {
  if (!message.guild || message.author.bot) return null;
  if (message.member?.permissions?.has("ManageMessages")) return null;

  const cfg = getAutomodConfig(message.guild.id);
  if (!cfg.enabled) return null;

  if (cfg.spamFilter?.enabled) {
    const key = `${message.guild.id}:${message.author.id}`;
    const now = Date.now();
    const timestamps = spamTracker.get(key) || [];
    timestamps.push(now);
    const recent = timestamps.filter((t) => now - t < cfg.spamFilter.interval);
    spamTracker.set(key, recent);
    if (recent.length > cfg.spamFilter.maxMessages) {
      spamTracker.set(key, []);
      return { action: cfg.spamFilter.action, reason: `Spam: ${recent.length} messages in ${cfg.spamFilter.interval / 1000}s` };
    }
  }

  if (cfg.wordFilter?.enabled && cfg.wordFilter.words.length > 0) {
    const lower = message.content.toLowerCase();
    for (const word of cfg.wordFilter.words) {
      const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (regex.test(lower)) {
        return { action: cfg.wordFilter.action, reason: `Blocked word: ${word}` };
      }
    }
  }

  if (cfg.linkFilter?.enabled) {
    const urls = message.content.match(URL_REGEX);
    if (urls) {
      const whitelist = cfg.linkFilter.whitelist || [];
      const blocked = urls.some((url) => {
        try {
          const host = new URL(url).hostname;
          return !whitelist.some((w) => host === w || host.endsWith(`.${w}`));
        } catch { return true; }
      });
      if (blocked) return { action: cfg.linkFilter.action, reason: "Unauthorized link" };
    }
  }

  if (cfg.capsFilter?.enabled) {
    const text = message.content.replace(/[^a-zA-Z]/g, "");
    if (text.length >= cfg.capsFilter.minLength) {
      const upperPct = (text.replace(/[^A-Z]/g, "").length / text.length) * 100;
      if (upperPct >= cfg.capsFilter.threshold) {
        return { action: cfg.capsFilter.action, reason: `Excessive caps (${Math.round(upperPct)}%)` };
      }
    }
  }

  return null;
}

export async function executeAction(message, result) {
  const { action, reason } = result;
  try { await message.delete(); } catch {}
  if (action === "mute") {
    try { await message.member.timeout(5 * 60 * 1000, `Auto-mod: ${reason}`); } catch {}
  } else if (action === "kick") {
    try { await message.member.kick(`Auto-mod: ${reason}`); } catch {}
  }
  try {
    await message.channel.send({
      embeds: [{ color: 0xed4245, description: `Auto-mod: <@${message.author.id}> — ${reason}`, footer: { text: `Action: ${action}` } }],
    });
  } catch {}
  sendModLog(message.client, message.guild.id, "warn", { userId: message.author.id, moderatorId: "auto-mod", reason });
}
