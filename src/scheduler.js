import cron from "node-cron";
import { CronExpressionParser, CronDate } from "cron-parser";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { getDataDir } from "./dataDir.js";

function getStorePath() {
  return join(getDataDir(), "schedules.json");
}

/** @type {Map<string, { stop: () => void }>} */
const jobs = new Map();
let client = null;

function loadSchedules() {
  try {
    const path = getStorePath();
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, "utf8"));
    }
  } catch (e) {
    console.error("Failed to load schedules:", e);
  }
  return [];
}

function saveSchedules(schedules) {
  try {
    const dir = getDataDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(getStorePath(), JSON.stringify(schedules, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to save schedules:", e);
  }
}

function generateId() {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Build cron expression from schedule type and options.
 * @returns {{ cron: string, label: string }}
 */
export function buildCron(scheduleType, options = {}) {
  const tz = options.timezone || "UTC";
  switch (scheduleType) {
    case "interval_minutes": {
      const n = Math.max(1, Math.min(60, Number(options.minutes) || 1));
      const cron = n === 1 ? "* * * * *" : `*/${n} * * * *`;
      return { cron, label: `Every ${n} minute(s)` };
    }
    case "daily": {
      const [h = 0, m = 0] = (options.time || "00:00").toString().split(":").map(Number);
      const cron = `${m} ${h} * * *`;
      return { cron, label: `Daily at ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} (${tz})` };
    }
    case "weekly": {
      const dow = Math.max(0, Math.min(7, Number(options.day_of_week) ?? 0));
      const [h = 0, m = 0] = (options.time || "00:00").toString().split(":").map(Number);
      const cron = `${m} ${h} * * ${dow}`;
      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      return { cron, label: `Weekly on ${days[dow]} at ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} (${tz})` };
    }
    default:
      return { cron: "* * * * *", label: "Every minute" };
  }
}

/**
 * @param {import("discord.js").Client} discordClient
 */
export function initScheduler(discordClient) {
  client = discordClient;
  const schedules = loadSchedules();
  for (const s of schedules) {
    try {
      startJob(s);
    } catch (e) {
      console.error("Failed to restore schedule", s.id, e);
    }
  }
  console.log(`Scheduler loaded ${jobs.size} schedule(s).`);
}

function startJob(schedule) {
  if (jobs.has(schedule.id)) return;
  const scheduleId = schedule.id;
  const task = cron.schedule(
    schedule.cron,
    async () => {
      const list = loadSchedules();
      const s = list.find((x) => x.id === scheduleId);
      if (!s || s.paused) return;
      if (!client) return;
      try {
        const channel = await client.channels.fetch(s.channelId).catch(() => null);
        if (!channel) return;
        const content = s.messages?.length > 0
          ? s.messages[Math.floor(Math.random() * s.messages.length)]
          : (s.payload?.content ?? " ");
        await channel.send({ content: String(content).trim() || " " });
      } catch (e) {
        console.error("Scheduled message failed:", scheduleId, e);
      }
    },
    { timezone: schedule.timezone || "UTC" }
  );
  jobs.set(schedule.id, { stop: () => task.stop() });
}

function stopJob(id) {
  const j = jobs.get(id);
  if (j) {
    j.stop();
    jobs.delete(id);
  }
}

/**
 * Add a new schedule.
 * @param {{ channelId: string, payload?: object, messages?: string[], scheduleType: string, options: object, createdBy?: string }} params
 * @returns {{ id: string, label: string }}
 */
export function addSchedule({ channelId, payload, messages, scheduleType, options = {}, createdBy = null }) {
  const { cron: cronExpr, label } = buildCron(scheduleType, options);
  const id = generateId();
  const timezone = options.timezone || "UTC";
  const schedule = {
    id,
    channelId,
    payload: payload ?? (messages?.length ? { content: messages[0] } : { content: " " }),
    messages: Array.isArray(messages) && messages.length > 0 ? messages.map((m) => String(m).trim() || " ") : undefined,
    cron: cronExpr,
    timezone,
    label,
    scheduleType,
    options,
    createdBy: createdBy || null,
    paused: false,
  };
  const schedules = loadSchedules();
  schedules.push(schedule);
  saveSchedules(schedules);
  startJob(schedule);
  return { id, label };
}

/**
 * Get a single schedule by id (raw object with createdBy).
 */
export function getScheduleById(id) {
  const schedules = loadSchedules();
  return schedules.find((s) => s.id === id) || null;
}

/**
 * Remove a schedule by id.
 * @param {string} id
 * @returns {boolean}
 */
export function removeSchedule(id) {
  const schedules = loadSchedules();
  const found = schedules.some((s) => s.id === id);
  if (!found) return false;
  stopJob(id);
  saveSchedules(schedules.filter((s) => s.id !== id));
  return true;
}

/**
 * Get the next run time for a schedule (accurate to the second), or null if paused.
 * Uses cron-parser when possible; falls back to manual calculation for interval_minutes.
 * @param {object} schedule - Full schedule object with cron, timezone, paused, scheduleType, options
 * @returns {string|null} ISO date string of next run, or null
 */
export function getNextRun(schedule) {
  if (schedule.paused) return null;
  const tz = schedule.timezone || schedule.options?.timezone || "UTC";

  try {
    // cron-parser expects 6 fields (second minute hour day month dayOfWeek); node-cron uses 5
    const cron = schedule.cron.trim().split(/\s+/).length === 5 ? "0 " + schedule.cron : schedule.cron;
    const currentInTz = new CronDate(Date.now(), tz);
    const interval = CronExpressionParser.parse(cron, {
      currentDate: currentInTz,
      tz,
    });
    const next = interval.next();
    return next.toDate().toISOString();
  } catch (e) {
    console.warn("getNextRun (cron-parser) failed for schedule", schedule.id, e.message);
  }

  // Fallback only for interval_minutes (no TZ math needed)
  if (schedule.scheduleType === "interval_minutes") {
    try {
      const now = new Date();
      const n = Math.max(1, Math.min(60, Number(schedule.options?.minutes) || 1));
      const msPer = n * 60 * 1000;
      const next = new Date(Math.ceil(now.getTime() / msPer) * msPer);
      return next.toISOString();
    } catch (err) {
      console.warn("getNextRun (interval fallback) failed", schedule.id, err.message);
    }
  }
  return null;
}

/**
 * List all schedules (includes createdBy and paused for filtering/UI).
 * @returns {Array<{ id: string, channelId: string, label: string, preview: string, createdBy: string|null, paused: boolean, messagesCount?: number }>}
 */
export function listSchedules() {
  return loadSchedules().map((s) => {
    const multi = s.messages?.length;
    const preview = multi > 1
      ? `${multi} messages (random)`
      : (s.messages?.[0] || s.payload?.content || (s.payload?.embeds?.[0]?.title || s.payload?.embeds?.[0]?.description) || "").slice(0, 50);
    return {
      id: s.id,
      channelId: s.channelId,
      label: s.label,
      preview,
      createdBy: s.createdBy ?? null,
      paused: !!s.paused,
      messagesCount: multi,
    };
  });
}

/**
 * Set paused state for a schedule. Does not restart the cron job; the job checks paused on each run.
 * @param {string} id
 * @param {boolean} paused
 * @returns {boolean}
 */
export function setSchedulePaused(id, paused) {
  const schedules = loadSchedules();
  const idx = schedules.findIndex((s) => s.id === id);
  if (idx === -1) return false;
  schedules[idx].paused = !!paused;
  saveSchedules(schedules);
  return true;
}

/**
 * Update an existing schedule (content, messages, scheduleType, options). Rebuilds cron and restarts the job.
 * @param {string} id
 * @param {{ content?: string, messages?: string[], scheduleType?: string, timezone?: string, minutes?: number, time?: string, day_of_week?: number }} updates
 * @returns {{ id: string, label: string } | null}
 */
export function updateSchedule(id, updates) {
  const schedules = loadSchedules();
  const idx = schedules.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  const s = schedules[idx];
  if (updates.messages != null) {
    s.messages = Array.isArray(updates.messages) && updates.messages.length > 0
      ? updates.messages.map((m) => String(m).trim() || " ")
      : undefined;
    s.payload = { ...s.payload, content: s.messages?.[0] || " " };
  }
  if (updates.content != null) {
    s.payload = { ...s.payload, content: String(updates.content).trim() || " " };
    if (!s.messages) s.messages = [s.payload.content];
    else s.messages[0] = s.payload.content;
  }
  if (updates.scheduleType != null) s.scheduleType = updates.scheduleType;
  if (updates.timezone != null) s.options = { ...s.options, timezone: updates.timezone };
  if (updates.minutes != null) s.options = { ...s.options, minutes: updates.minutes };
  if (updates.time != null) s.options = { ...s.options, time: updates.time };
  if (updates.day_of_week != null) s.options = { ...s.options, day_of_week: updates.day_of_week };
  const { cron, label } = buildCron(s.scheduleType, s.options);
  s.cron = cron;
  s.label = label;
  s.timezone = s.options.timezone || "UTC";
  stopJob(id);
  saveSchedules(schedules);
  startJob(s);
  return { id: s.id, label: s.label };
}
