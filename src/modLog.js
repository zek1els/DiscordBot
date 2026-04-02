import { getDb } from "./storage.js";

let _init = false;
function ensureTable() {
  if (_init) return;
  _init = true;
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS modlog_config (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS mod_log_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT,
    action TEXT,
    user_id TEXT,
    moderator_id TEXT,
    reason TEXT,
    duration TEXT,
    extra TEXT,
    timestamp INTEGER
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_modlog_guild ON mod_log_entries (guild_id, timestamp DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_modlog_guild_action ON mod_log_entries (guild_id, action)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_modlog_guild_user ON mod_log_entries (guild_id, user_id)`);
}

export function getModLogChannel(guildId) {
  ensureTable();
  const row = getDb().prepare("SELECT channel_id FROM modlog_config WHERE guild_id = ?").get(guildId);
  return row?.channel_id || null;
}

export function setModLogChannel(guildId, channelId) {
  ensureTable();
  getDb().prepare("INSERT OR REPLACE INTO modlog_config (guild_id, channel_id) VALUES (?, ?)").run(guildId, channelId);
}

export function disableModLog(guildId) {
  ensureTable();
  getDb().prepare("DELETE FROM modlog_config WHERE guild_id = ?").run(guildId);
}

const COLORS = {
  join: 0x57f287, leave: 0xed4245, ban: 0xed4245, unban: 0x57f287,
  kick: 0xe67e22, jail: 0xed4245, unjail: 0x57f287, warn: 0xfee75c,
  mute: 0xe67e22, unmute: 0x57f287, role_add: 0x5865f2, role_remove: 0xe67e22,
  nick_change: 0x5865f2, message_delete: 0xed4245, message_edit: 0xfee75c,
  voice_join: 0x57f287, voice_leave: 0xed4245, voice_move: 0x5865f2,
  channel_create: 0x57f287, channel_delete: 0xed4245,
};

const ICONS = {
  join: "\ud83d\udce5", leave: "\ud83d\udce4", ban: "\ud83d\udd28", unban: "\ud83d\udd13",
  kick: "\ud83d\udc62", jail: "\ud83d\udd12", unjail: "\ud83d\udd13", warn: "\u26a0\ufe0f",
  mute: "\ud83d\udd07", unmute: "\ud83d\udd0a", role_add: "\ud83c\udff7\ufe0f", role_remove: "\ud83c\udff7\ufe0f",
  nick_change: "\u270f\ufe0f", message_delete: "\ud83d\uddd1\ufe0f", message_edit: "\ud83d\udcdd",
  voice_join: "\ud83d\udd0a", voice_leave: "\ud83d\udd07", voice_move: "\ud83d\udd00",
  channel_create: "\ud83d\udcc1", channel_delete: "\ud83d\udcc1",
};

export async function sendModLog(client, guildId, action, details = {}) {
  const channelId = getModLogChannel(guildId);
  if (!channelId) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  const icon = ICONS[action] || "\ud83d\udccb";
  const color = COLORS[action] || 0x99aab5;
  const title = `${icon}  ${action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}`;

  const fields = [];
  if (details.userId) fields.push({ name: "User", value: `<@${details.userId}> (${details.userId})`, inline: true });
  if (details.moderatorId) {
    const modLabel = details.moderatorId === "auto-spam" ? "Auto-Spam" : details.moderatorId === "auto-mod" ? "Auto-Mod" : details.moderatorId === "auto-timer" ? "Auto-Timer" : `<@${details.moderatorId}>`;
    fields.push({ name: "Moderator", value: modLabel, inline: true });
  }
  if (details.reason) fields.push({ name: "Reason", value: details.reason, inline: false });
  if (details.duration) fields.push({ name: "Duration", value: details.duration, inline: true });
  if (details.role) fields.push({ name: "Role", value: details.role, inline: true });
  if (details.channel) fields.push({ name: "Channel", value: details.channel, inline: true });
  if (details.oldNick || details.newNick) {
    fields.push({ name: "Old Nick", value: details.oldNick || "*none*", inline: true });
    fields.push({ name: "New Nick", value: details.newNick || "*none*", inline: true });
  }
  if (details.content) fields.push({ name: "Content", value: details.content.slice(0, 1024), inline: false });
  if (details.oldContent && details.newContent) {
    fields.push({ name: "Before", value: details.oldContent.slice(0, 512), inline: false });
    fields.push({ name: "After", value: details.newContent.slice(0, 512), inline: false });
  }
  if (details.extra) fields.push({ name: "Details", value: details.extra, inline: false });

  try {
    ensureTable();
    const extraParts = [];
    if (details.role) extraParts.push(`Role: ${details.role}`);
    if (details.channel) extraParts.push(`Channel: ${details.channel}`);
    if (details.oldNick || details.newNick) extraParts.push(`Nick: ${details.oldNick || "*none*"} \u2192 ${details.newNick || "*none*"}`);
    if (details.content) extraParts.push(`Content: ${details.content.slice(0, 1024)}`);
    if (details.oldContent && details.newContent) extraParts.push(`Before: ${details.oldContent.slice(0, 512)}\nAfter: ${details.newContent.slice(0, 512)}`);
    if (details.extra) extraParts.push(details.extra);

    getDb().prepare(
      `INSERT INTO mod_log_entries (guild_id, action, user_id, moderator_id, reason, duration, extra, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(guildId, action, details.userId || null, details.moderatorId || null, details.reason || null, details.duration || null, extraParts.length ? extraParts.join("\n") : null, Date.now());
  } catch (e) {
    console.error("Mod log DB insert failed:", e.message);
  }

  await channel.send({
    embeds: [{ color, title, fields, timestamp: new Date().toISOString(), footer: { text: `ID: ${details.userId || details.channelId || "N/A"}` } }],
  }).catch((e) => console.error("Mod log send failed:", e.message));
}

export function getModLogHistory(guildId, { action, userId, page = 1, limit = 50 } = {}) {
  ensureTable();
  const db = getDb();
  const conditions = ["guild_id = ?"];
  const params = [guildId];
  if (action) { conditions.push("action = ?"); params.push(action); }
  if (userId) { conditions.push("user_id = ?"); params.push(userId); }
  const where = conditions.join(" AND ");
  const total = db.prepare(`SELECT COUNT(*) AS cnt FROM mod_log_entries WHERE ${where}`).get(...params).cnt;
  const safePage = Math.max(1, Math.floor(page));
  const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 200);
  const offset = (safePage - 1) * safeLimit;
  const totalPages = Math.max(1, Math.ceil(total / safeLimit));
  const entries = db.prepare(`SELECT * FROM mod_log_entries WHERE ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`).all(...params, safeLimit, offset);
  return { entries, total, page: safePage, totalPages };
}
