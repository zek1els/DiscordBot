import cron from "node-cron";
import { CronExpressionParser, CronDate } from "cron-parser";
import { getDb } from "./storage.js";
import { get as getSavedMessage } from "./savedMessages.js";

let _init = false;
function ensureTable() {
  if (_init) return;
  _init = true;
  getDb().exec(`CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    payload TEXT DEFAULT '{}',
    messages TEXT,
    saved_message_names TEXT,
    cron_expr TEXT NOT NULL,
    timezone TEXT DEFAULT 'UTC',
    label TEXT,
    schedule_type TEXT,
    options TEXT DEFAULT '{}',
    created_by TEXT,
    paused INTEGER DEFAULT 0
  )`);
}

const jobs = new Map();
let client = null;

function loadSchedules() {
  ensureTable();
  return getDb().prepare("SELECT * FROM schedules").all().map(rowToSchedule);
}

function rowToSchedule(row) {
  return {
    id: row.id, channelId: row.channel_id,
    payload: JSON.parse(row.payload || "{}"),
    messages: row.messages ? JSON.parse(row.messages) : undefined,
    savedMessageNames: row.saved_message_names ? JSON.parse(row.saved_message_names) : undefined,
    cron: row.cron_expr, timezone: row.timezone, label: row.label,
    scheduleType: row.schedule_type, options: JSON.parse(row.options || "{}"),
    createdBy: row.created_by, paused: !!row.paused,
  };
}

function saveSchedule(s) {
  ensureTable();
  getDb().prepare(`INSERT OR REPLACE INTO schedules (id, channel_id, payload, messages, saved_message_names, cron_expr, timezone, label, schedule_type, options, created_by, paused)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    s.id, s.channelId, JSON.stringify(s.payload),
    s.messages ? JSON.stringify(s.messages) : null,
    s.savedMessageNames ? JSON.stringify(s.savedMessageNames) : null,
    s.cron, s.timezone, s.label, s.scheduleType,
    JSON.stringify(s.options), s.createdBy, s.paused ? 1 : 0
  );
}

function generateId() {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function buildCron(scheduleType, options = {}) {
  const tz = options.timezone || "UTC";
  switch (scheduleType) {
    case "interval_minutes": {
      const n = Math.max(1, Math.min(60, Number(options.minutes) || 1));
      return { cron: n === 1 ? "* * * * *" : `*/${n} * * * *`, label: `Every ${n} minute(s)` };
    }
    case "daily": {
      const [h = 0, m = 0] = (options.time || "00:00").toString().split(":").map(Number);
      return { cron: `${m} ${h} * * *`, label: `Daily at ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} (${tz})` };
    }
    case "weekly": {
      const dow = Math.max(0, Math.min(7, Number(options.day_of_week) ?? 0));
      const [h = 0, m = 0] = (options.time || "00:00").toString().split(":").map(Number);
      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      return { cron: `${m} ${h} * * ${dow}`, label: `Weekly on ${days[dow]} at ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} (${tz})` };
    }
    default: return { cron: "* * * * *", label: "Every minute" };
  }
}

export function initScheduler(discordClient) {
  client = discordClient;
  const schedules = loadSchedules();
  for (const s of schedules) {
    try { startJob(s); } catch (e) { console.error("Failed to restore schedule", s.id, e); }
  }
  console.log(`Scheduler loaded ${jobs.size} schedule(s).`);
}

function startJob(schedule) {
  if (jobs.has(schedule.id)) return;
  const scheduleId = schedule.id;
  const task = cron.schedule(schedule.cron, async () => {
    ensureTable();
    const row = getDb().prepare("SELECT * FROM schedules WHERE id = ?").get(scheduleId);
    if (!row || row.paused) return;
    const s = rowToSchedule(row);
    if (!client) return;
    try {
      const channel = await client.channels.fetch(s.channelId).catch(() => null);
      if (!channel) return;
      let payloadToSend;
      if (s.savedMessageNames?.length > 0) {
        const name = s.savedMessageNames[Math.floor(Math.random() * s.savedMessageNames.length)];
        payloadToSend = getSavedMessage(name, s.createdBy || "_global") || { content: `(Saved message "${name}" not found)` };
      } else if (s.messages?.length > 0) {
        payloadToSend = { content: String(s.messages[Math.floor(Math.random() * s.messages.length)]).trim() || " " };
      } else {
        payloadToSend = { content: (s.payload?.content ?? " ").trim() || " " };
      }
      await channel.send(payloadToSend);
    } catch (e) { console.error("Scheduled message failed:", scheduleId, e); }
  }, { timezone: schedule.timezone || "UTC" });
  jobs.set(schedule.id, { stop: () => task.stop() });
}

function stopJob(id) {
  const j = jobs.get(id);
  if (j) { j.stop(); jobs.delete(id); }
}

export function addSchedule({ channelId, payload, messages, savedMessageNames, scheduleType, options = {}, createdBy = null }) {
  const { cron: cronExpr, label } = buildCron(scheduleType, options);
  const id = generateId();
  const timezone = options.timezone || "UTC";
  const hasSaved = Array.isArray(savedMessageNames) && savedMessageNames.length > 0;
  const hasMessages = Array.isArray(messages) && messages.length > 0;
  const schedule = {
    id, channelId,
    payload: payload ?? (hasMessages ? { content: messages[0] } : { content: " " }),
    messages: hasMessages ? messages.map((m) => String(m).trim() || " ") : undefined,
    savedMessageNames: hasSaved ? savedMessageNames.map((n) => String(n).trim()).filter(Boolean) : undefined,
    cron: cronExpr, timezone, label, scheduleType, options, createdBy, paused: false,
  };
  saveSchedule(schedule);
  startJob(schedule);
  return { id, label };
}

export function getScheduleById(id) {
  ensureTable();
  const row = getDb().prepare("SELECT * FROM schedules WHERE id = ?").get(id);
  return row ? rowToSchedule(row) : null;
}

export function removeSchedule(id) {
  ensureTable();
  const found = getDb().prepare("SELECT 1 FROM schedules WHERE id = ?").get(id);
  if (!found) return false;
  stopJob(id);
  getDb().prepare("DELETE FROM schedules WHERE id = ?").run(id);
  return true;
}

export function getNextRun(schedule) {
  if (schedule.paused) return null;
  const tz = schedule.timezone || schedule.options?.timezone || "UTC";
  try {
    const cronStr = schedule.cron.trim().split(/\s+/).length === 5 ? "0 " + schedule.cron : schedule.cron;
    const currentInTz = new CronDate(Date.now(), tz);
    const interval = CronExpressionParser.parse(cronStr, { currentDate: currentInTz, tz });
    return interval.next().toDate().toISOString();
  } catch (e) { console.warn("getNextRun failed for", schedule.id, e.message); }
  if (schedule.scheduleType === "interval_minutes") {
    const n = Math.max(1, Math.min(60, Number(schedule.options?.minutes) || 1));
    const msPer = n * 60 * 1000;
    return new Date(Math.ceil(Date.now() / msPer) * msPer).toISOString();
  }
  return null;
}

export function listSchedules() {
  return loadSchedules().map((s) => {
    const savedCount = s.savedMessageNames?.length;
    const multi = s.messages?.length;
    let preview;
    if (savedCount > 0) preview = savedCount === 1 ? `Saved: ${s.savedMessageNames[0]}` : `${savedCount} saved messages (random)`;
    else if (multi > 1) preview = `${multi} messages (random)`;
    else preview = (s.messages?.[0] || s.payload?.content || (s.payload?.embeds?.[0]?.title || s.payload?.embeds?.[0]?.description) || "").slice(0, 50);
    return { id: s.id, channelId: s.channelId, label: s.label, preview, createdBy: s.createdBy ?? null, paused: s.paused, messagesCount: multi, savedMessageNames: s.savedMessageNames };
  });
}

export function setSchedulePaused(id, paused) {
  ensureTable();
  const changes = getDb().prepare("UPDATE schedules SET paused = ? WHERE id = ?").run(paused ? 1 : 0, id).changes;
  return changes > 0;
}

export function updateSchedule(id, updates) {
  ensureTable();
  const row = getDb().prepare("SELECT * FROM schedules WHERE id = ?").get(id);
  if (!row) return null;
  const s = rowToSchedule(row);
  if (updates.savedMessageNames != null) s.savedMessageNames = Array.isArray(updates.savedMessageNames) && updates.savedMessageNames.length > 0 ? updates.savedMessageNames.map((n) => String(n).trim()).filter(Boolean) : undefined;
  if (updates.messages != null) { s.messages = Array.isArray(updates.messages) && updates.messages.length > 0 ? updates.messages.map((m) => String(m).trim() || " ") : undefined; s.payload = { ...s.payload, content: s.messages?.[0] || " " }; }
  if (updates.content != null) { s.payload = { ...s.payload, content: String(updates.content).trim() || " " }; if (!s.messages) s.messages = [s.payload.content]; else s.messages[0] = s.payload.content; }
  if (updates.scheduleType != null) s.scheduleType = updates.scheduleType;
  if (updates.timezone != null) s.options = { ...s.options, timezone: updates.timezone };
  if (updates.minutes != null) s.options = { ...s.options, minutes: updates.minutes };
  if (updates.time != null) s.options = { ...s.options, time: updates.time };
  if (updates.day_of_week != null) s.options = { ...s.options, day_of_week: updates.day_of_week };
  const { cron, label } = buildCron(s.scheduleType, s.options);
  s.cron = cron; s.label = label; s.timezone = s.options.timezone || "UTC";
  stopJob(id);
  saveSchedule(s);
  startJob(s);
  return { id: s.id, label: s.label };
}
