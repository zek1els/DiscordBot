import { getDb } from "./storage.js";

let _init = false;
function ensureTable() {
  if (_init) return;
  _init = true;
  getDb().exec(`CREATE TABLE IF NOT EXISTS welcome_config (
    guild_id TEXT PRIMARY KEY,
    welcome_channel_id TEXT,
    welcome_message TEXT,
    leave_channel_id TEXT,
    leave_message TEXT
  )`);
}

export function getWelcomeConfig(guildId) {
  ensureTable();
  const row = getDb().prepare("SELECT * FROM welcome_config WHERE guild_id = ?").get(guildId);
  if (!row) return null;
  return {
    welcomeChannelId: row.welcome_channel_id, welcomeMessage: row.welcome_message,
    leaveChannelId: row.leave_channel_id, leaveMessage: row.leave_message,
  };
}

export function setWelcomeMessage(guildId, channelId, message) {
  ensureTable();
  const db = getDb();
  const existing = db.prepare("SELECT 1 FROM welcome_config WHERE guild_id = ?").get(guildId);
  if (existing) {
    db.prepare("UPDATE welcome_config SET welcome_channel_id = ?, welcome_message = ? WHERE guild_id = ?").run(channelId, message, guildId);
  } else {
    db.prepare("INSERT INTO welcome_config (guild_id, welcome_channel_id, welcome_message) VALUES (?, ?, ?)").run(guildId, channelId, message);
  }
}

export function setLeaveMessage(guildId, channelId, message) {
  ensureTable();
  const db = getDb();
  const existing = db.prepare("SELECT 1 FROM welcome_config WHERE guild_id = ?").get(guildId);
  if (existing) {
    db.prepare("UPDATE welcome_config SET leave_channel_id = ?, leave_message = ? WHERE guild_id = ?").run(channelId, message, guildId);
  } else {
    db.prepare("INSERT INTO welcome_config (guild_id, leave_channel_id, leave_message) VALUES (?, ?, ?)").run(guildId, channelId, message);
  }
}

export function disableWelcome(guildId) {
  ensureTable();
  getDb().prepare("UPDATE welcome_config SET welcome_channel_id = NULL, welcome_message = NULL WHERE guild_id = ?").run(guildId);
}

export function disableLeave(guildId) {
  ensureTable();
  getDb().prepare("UPDATE welcome_config SET leave_channel_id = NULL, leave_message = NULL WHERE guild_id = ?").run(guildId);
}

function processTemplate(template, member) {
  return template
    .replace(/{user}/gi, `<@${member.id}>`)
    .replace(/{username}/gi, member.user?.username || member.displayName || "User")
    .replace(/{server}/gi, member.guild?.name || "Server")
    .replace(/{memberCount}/gi, String(member.guild?.memberCount || "?"))
    .replace(/{tag}/gi, member.user?.tag || member.user?.username || "User");
}

export async function handleMemberJoin(member) {
  const config = getWelcomeConfig(member.guild.id);
  if (!config?.welcomeChannelId || !config?.welcomeMessage) return;
  try {
    const channel = await member.guild.channels.fetch(config.welcomeChannelId).catch(() => null);
    if (!channel?.isTextBased()) return;
    const text = processTemplate(config.welcomeMessage, member);
    await channel.send({
      embeds: [{
        color: 0x57f287, description: text,
        thumbnail: { url: member.user.displayAvatarURL({ size: 256, dynamic: true }) },
        footer: { text: `Member #${member.guild.memberCount}` },
        timestamp: new Date().toISOString(),
      }],
    });
  } catch (e) { console.error("Welcome message failed:", e.message); }
}

export async function handleMemberLeave(member) {
  const config = getWelcomeConfig(member.guild.id);
  if (!config?.leaveChannelId || !config?.leaveMessage) return;
  try {
    const channel = await member.guild.channels.fetch(config.leaveChannelId).catch(() => null);
    if (!channel?.isTextBased()) return;
    const text = processTemplate(config.leaveMessage, member);
    await channel.send({
      embeds: [{
        color: 0xed4245, description: text,
        footer: { text: `${member.guild.memberCount} members remaining` },
        timestamp: new Date().toISOString(),
      }],
    });
  } catch (e) { console.error("Leave message failed:", e.message); }
}
