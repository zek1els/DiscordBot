import { getDb } from "./storage.js";
import { randomBytes } from "crypto";
import { safeTimeout } from "./safeTimeout.js";

let _init = false;
function ensureTable() {
  if (_init) return;
  _init = true;
  getDb().exec(`CREATE TABLE IF NOT EXISTS reminders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    channel_id TEXT,
    message TEXT,
    fire_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`);
}

const timers = new Map();
let discordClient = null;

const TIME_REGEX = /^(\d+)\s*(s|sec|seconds?|m|min|minutes?|h|hr|hours?|d|days?)$/i;
const MAX_REMINDERS_PER_USER = 25;

function parseTime(input) {
  const match = input.match(TIME_REGEX);
  if (!match) return null;
  const num = parseInt(match[1]);
  const unit = match[2].toLowerCase().charAt(0);
  const multipliers = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return num * (multipliers[unit] || 60_000);
}

function formatMs(ms) {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

export function initReminders(client) {
  discordClient = client;
  ensureTable();
  const db = getDb();
  const reminders = db.prepare("SELECT * FROM reminders").all();
  const now = Date.now();
  for (const r of reminders) {
    if (r.fire_at <= now) {
      fireReminder(r);
      db.prepare("DELETE FROM reminders WHERE id = ?").run(r.id);
    } else {
      scheduleTimer(r);
    }
  }
  console.log(`Reminders: ${reminders.length} loaded.`);
}

function scheduleTimer(reminder) {
  const delay = Math.max(1000, reminder.fire_at - Date.now());
  const handle = safeTimeout(() => {
    fireReminder(reminder);
    getDb().prepare("DELETE FROM reminders WHERE id = ?").run(reminder.id);
    timers.delete(reminder.id);
  }, delay);
  timers.set(reminder.id, handle);
}

async function fireReminder(reminder) {
  if (!discordClient) return;
  try {
    const user = await discordClient.users.fetch(reminder.user_id).catch(() => null);
    if (user) {
      await user.send({
        embeds: [{ color: 0xfee75c, title: "\u23f0 Reminder!", description: reminder.message || "*(no message)*", footer: { text: `Set ${formatMs(Date.now() - (reminder.created_at || Date.now()))} ago` } }],
      }).catch(() => {});
    }
    if (reminder.channel_id) {
      const channel = await discordClient.channels.fetch(reminder.channel_id).catch(() => null);
      if (channel?.isTextBased()) {
        channel.send({ content: `<@${reminder.user_id}>`, embeds: [{ color: 0xfee75c, description: `\u23f0 **Reminder:** ${reminder.message || "*(no message)*"}` }] }).catch(() => {});
      }
    }
  } catch (e) { console.error("Reminder fire failed:", e.message); }
}

export function createReminder(userId, channelId, timeStr, message) {
  const ms = parseTime(timeStr);
  if (!ms) return { ok: false, error: "Invalid time. Use: `30s`, `5m`, `2h`, `1d`" };
  if (ms < 10_000) return { ok: false, error: "Minimum reminder time is 10 seconds." };
  if (ms > 30 * 86_400_000) return { ok: false, error: "Maximum reminder time is 30 days." };

  ensureTable();
  const db = getDb();
  const userCount = db.prepare("SELECT COUNT(*) AS cnt FROM reminders WHERE user_id = ?").get(userId).cnt;
  if (userCount >= MAX_REMINDERS_PER_USER) return { ok: false, error: `You can have at most ${MAX_REMINDERS_PER_USER} reminders.` };

  const reminder = { id: randomBytes(4).toString("hex"), user_id: userId, channel_id: channelId, message: message.slice(0, 500), fire_at: Date.now() + ms, created_at: Date.now() };
  db.prepare("INSERT INTO reminders (id, user_id, channel_id, message, fire_at, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(reminder.id, reminder.user_id, reminder.channel_id, reminder.message, reminder.fire_at, reminder.created_at);
  scheduleTimer(reminder);
  return { ok: true, id: reminder.id, fireAt: reminder.fire_at };
}

export function listReminders(userId) {
  ensureTable();
  return getDb().prepare("SELECT id, message, fire_at AS fireAt FROM reminders WHERE user_id = ? AND fire_at > ? ORDER BY fire_at ASC").all(userId, Date.now());
}

export function cancelReminder(userId, reminderId) {
  ensureTable();
  const changes = getDb().prepare("DELETE FROM reminders WHERE id = ? AND user_id = ?").run(reminderId, userId).changes;
  if (changes > 0) {
    const timer = timers.get(reminderId);
    if (timer) { timer.clear(); timers.delete(reminderId); }
    return true;
  }
  return false;
}

export { parseTime, formatMs };
