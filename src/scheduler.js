import cron from "node-cron";
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
  const task = cron.schedule(
    schedule.cron,
    async () => {
      if (!client) return;
      try {
        const channel = await client.channels.fetch(schedule.channelId).catch(() => null);
        if (!channel) return;
        await channel.send(schedule.payload);
      } catch (e) {
        console.error("Scheduled message failed:", schedule.id, e);
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
 * @param {{ channelId: string, payload: object, scheduleType: string, options: object, createdBy?: string }} params
 * @returns {{ id: string, label: string }}
 */
export function addSchedule({ channelId, payload, scheduleType, options = {}, createdBy = null }) {
  const { cron: cronExpr, label } = buildCron(scheduleType, options);
  const id = generateId();
  const timezone = options.timezone || "UTC";
  const schedule = {
    id,
    channelId,
    payload,
    cron: cronExpr,
    timezone,
    label,
    scheduleType,
    options,
    createdBy: createdBy || null,
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
 * List all schedules (includes createdBy for filtering).
 * @returns {Array<{ id: string, channelId: string, label: string, preview: string, createdBy: string|null }>}
 */
export function listSchedules() {
  return loadSchedules().map((s) => ({
    id: s.id,
    channelId: s.channelId,
    label: s.label,
    preview: (s.payload.content || (s.payload.embeds?.[0]?.title || s.payload.embeds?.[0]?.description) || "").slice(0, 50),
    createdBy: s.createdBy ?? null,
  }));
}
