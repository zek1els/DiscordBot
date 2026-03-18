import { addSchedule, listSchedules, removeSchedule, getScheduleById, setSchedulePaused, updateSchedule, getNextRun } from "../scheduler.js";

/**
 * Register all schedule-related routes on the Express app.
 * @param {import("express").Express} app
 * @param {import("discord.js").Client} client
 * @param {object} helpers
 */
export function registerScheduleRoutes(app, client, { getCurrentUser, getOwnerId, isAdmin }) {
  function canEditSchedule(req, schedule) {
    if (isAdmin(req)) return true;
    const user = getCurrentUser(req);
    return user && schedule.createdBy === getOwnerId(user);
  }

  app.post("/api/schedule", async (req, res) => {
    const body = req.body || {};
    const { channelId, content, messages: messagesBody, savedMessageNames: savedNamesBody, scheduleType } = body;
    const hasContent = content != null && String(content).trim() !== "";
    const messagesArray = Array.isArray(messagesBody) ? messagesBody.filter((m) => m != null && String(m).trim() !== "") : [];
    const hasMessages = messagesArray.length > 0;
    const savedNames = Array.isArray(savedNamesBody) ? savedNamesBody.map((n) => String(n).trim()).filter(Boolean) : [];
    const hasSaved = savedNames.length > 0;
    if (!channelId || !scheduleType) {
      return res.status(400).json({
        error: "channelId and scheduleType required (scheduleType: interval_minutes | daily | weekly)",
      });
    }
    if (!hasContent && !hasMessages && !hasSaved) {
      return res.status(400).json({
        error: "Provide messages (plain text), savedMessageNames (saved template names), or content.",
      });
    }
    const user = getCurrentUser(req);
    const options = {
      timezone: body.timezone || "UTC",
      minutes: body.minutes ?? 1,
      time: body.time || "00:00",
      day_of_week: body.day_of_week ?? 0,
    };
    try {
      const payload = hasMessages ? undefined : hasSaved ? undefined : { content: String(content).trim() || " " };
      const messages = hasMessages ? messagesArray.map((m) => String(m).trim() || " ") : undefined;
      const savedMessageNames = hasSaved ? savedNames : undefined;
      const { id, label } = addSchedule({
        channelId: String(channelId),
        payload,
        messages,
        savedMessageNames,
        scheduleType,
        options,
        createdBy: getOwnerId(user) || null,
      });
      res.json({ ok: true, id, label });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/schedules", async (req, res) => {
    try {
      let list = listSchedules();
      const user = getCurrentUser(req);
      const admin = isAdmin(req);
      if (!admin && user) {
        const ownerId = getOwnerId(user);
        list = list.filter((s) => s.createdBy === ownerId);
      } else if (!admin) {
        list = [];
      }
      const enriched = await Promise.all(
        list.map(async (s) => {
          let serverName = "";
          let channelName = "";
          try {
            const ch = await client.channels.fetch(s.channelId);
            if (ch) {
              channelName = ch.name || "";
              serverName = ch.guild?.name || "";
            }
          } catch (_) {}
          const full = getScheduleById(s.id);
          const nextRunAt = full ? getNextRun(full) : null;
          return { ...s, serverName, channelName, nextRunAt };
        })
      );
      res.json({ schedules: enriched });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/schedules/:id", (req, res) => {
    const id = req.params.id;
    const schedule = getScheduleById(id);
    if (!schedule) return res.status(404).json({ error: "Schedule not found" });
    const user = getCurrentUser(req);
    const admin = isAdmin(req);
    if (!admin && user && schedule.createdBy !== getOwnerId(user)) {
      return res.status(403).json({ error: "You can only delete your own schedules" });
    }
    const removed = removeSchedule(id);
    if (!removed) return res.status(404).json({ error: "Schedule not found" });
    res.json({ ok: true });
  });

  app.patch("/api/schedules/:id", (req, res) => {
    const id = req.params.id;
    const schedule = getScheduleById(id);
    if (!schedule) return res.status(404).json({ error: "Schedule not found" });
    if (!canEditSchedule(req, schedule)) {
      return res.status(403).json({ error: "You can only edit your own schedules" });
    }
    const body = req.body || {};
    if (typeof body.paused === "boolean") {
      const ok = setSchedulePaused(id, body.paused);
      if (!ok) return res.status(404).json({ error: "Schedule not found" });
      return res.json({ ok: true, paused: body.paused });
    }
    const updates = {};
    if (body.content != null) updates.content = body.content;
    if (body.messages != null) updates.messages = Array.isArray(body.messages) ? body.messages : [body.content];
    if (body.savedMessageNames != null) updates.savedMessageNames = Array.isArray(body.savedMessageNames) ? body.savedMessageNames : [];
    if (body.scheduleType != null) updates.scheduleType = body.scheduleType;
    if (body.timezone != null) updates.timezone = body.timezone;
    if (body.minutes != null) updates.minutes = body.minutes;
    if (body.time != null) updates.time = body.time;
    if (body.day_of_week != null) updates.day_of_week = body.day_of_week;
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No updates provided (paused, content, messages, scheduleType, timezone, minutes, time, day_of_week)" });
    }
    const result = updateSchedule(id, updates);
    if (!result) return res.status(404).json({ error: "Schedule not found" });
    res.json({ ok: true, id: result.id, label: result.label });
  });

  app.get("/api/schedules/:id", (req, res) => {
    const id = req.params.id;
    const schedule = getScheduleById(id);
    if (!schedule) return res.status(404).json({ error: "Schedule not found" });
    if (!canEditSchedule(req, schedule)) {
      return res.status(403).json({ error: "You can only view your own schedules" });
    }
    const messages = schedule.messages?.length ? schedule.messages : [schedule.payload?.content ?? ""];
    res.json({
      id: schedule.id,
      channelId: schedule.channelId,
      content: messages[0] ?? "",
      messages,
      savedMessageNames: schedule.savedMessageNames || [],
      scheduleType: schedule.scheduleType,
      timezone: schedule.options?.timezone || "UTC",
      minutes: schedule.options?.minutes ?? 5,
      time: schedule.options?.time || "00:00",
      day_of_week: schedule.options?.day_of_week ?? 0,
      paused: !!schedule.paused,
      label: schedule.label,
    });
  });
}
