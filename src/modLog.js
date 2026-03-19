import { createStore } from "./storage.js";

const store = createStore("modlog.json");

/**
 * Get mod log channel for a guild.
 * @returns {string|null} channelId
 */
export function getModLogChannel(guildId) {
  const data = store.load();
  return data[guildId]?.channelId || null;
}

/**
 * Set the mod log channel for a guild.
 */
export function setModLogChannel(guildId, channelId) {
  const data = store.load();
  data[guildId] = { channelId };
  store.save(data);
}

/**
 * Disable mod logging for a guild.
 */
export function disableModLog(guildId) {
  const data = store.load();
  delete data[guildId];
  store.save(data);
}

const COLORS = {
  join: 0x57f287,
  leave: 0xed4245,
  ban: 0xed4245,
  unban: 0x57f287,
  kick: 0xe67e22,
  jail: 0xed4245,
  unjail: 0x57f287,
  warn: 0xfee75c,
  mute: 0xe67e22,
  unmute: 0x57f287,
  role_add: 0x5865f2,
  role_remove: 0xe67e22,
  nick_change: 0x5865f2,
  message_delete: 0xed4245,
  message_edit: 0xfee75c,
  voice_join: 0x57f287,
  voice_leave: 0xed4245,
  voice_move: 0x5865f2,
  channel_create: 0x57f287,
  channel_delete: 0xed4245,
};

const ICONS = {
  join: "📥",
  leave: "📤",
  ban: "🔨",
  unban: "🔓",
  kick: "👢",
  jail: "🔒",
  unjail: "🔓",
  warn: "⚠️",
  mute: "🔇",
  unmute: "🔊",
  role_add: "🏷️",
  role_remove: "🏷️",
  nick_change: "✏️",
  message_delete: "🗑️",
  message_edit: "📝",
  voice_join: "🔊",
  voice_leave: "🔇",
  voice_move: "🔀",
  channel_create: "📁",
  channel_delete: "📁",
};

/**
 * Send a mod log entry.
 * @param {import("discord.js").Client} client
 * @param {string} guildId
 * @param {string} action - one of the action keys above
 * @param {object} details
 */
export async function sendModLog(client, guildId, action, details = {}) {
  const channelId = getModLogChannel(guildId);
  if (!channelId) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  const icon = ICONS[action] || "📋";
  const color = COLORS[action] || 0x99aab5;
  const title = `${icon}  ${action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}`;

  const fields = [];

  if (details.userId) {
    fields.push({ name: "User", value: `<@${details.userId}> (${details.userId})`, inline: true });
  }
  if (details.moderatorId) {
    const modLabel = details.moderatorId === "auto-spam" ? "Auto-Spam" : `<@${details.moderatorId}>`;
    fields.push({ name: "Moderator", value: modLabel, inline: true });
  }
  if (details.reason) {
    fields.push({ name: "Reason", value: details.reason, inline: false });
  }
  if (details.duration) {
    fields.push({ name: "Duration", value: details.duration, inline: true });
  }
  if (details.role) {
    fields.push({ name: "Role", value: details.role, inline: true });
  }
  if (details.channel) {
    fields.push({ name: "Channel", value: details.channel, inline: true });
  }
  if (details.oldNick || details.newNick) {
    fields.push({ name: "Old Nick", value: details.oldNick || "*none*", inline: true });
    fields.push({ name: "New Nick", value: details.newNick || "*none*", inline: true });
  }
  if (details.content) {
    fields.push({ name: "Content", value: details.content.slice(0, 1024), inline: false });
  }
  if (details.oldContent && details.newContent) {
    fields.push({ name: "Before", value: details.oldContent.slice(0, 512), inline: false });
    fields.push({ name: "After", value: details.newContent.slice(0, 512), inline: false });
  }
  if (details.extra) {
    fields.push({ name: "Details", value: details.extra, inline: false });
  }

  await channel.send({
    embeds: [{
      color,
      title,
      fields,
      timestamp: new Date().toISOString(),
      footer: { text: `ID: ${details.userId || details.channelId || "N/A"}` },
    }],
  }).catch((e) => console.error("Mod log send failed:", e.message));
}
