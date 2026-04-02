import { getDb } from "./storage.js";

let _init = false;
function ensureTable() {
  if (_init) return;
  _init = true;
  getDb().exec(`CREATE TABLE IF NOT EXISTS reaction_roles (
    guild_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    emoji TEXT NOT NULL,
    role_id TEXT NOT NULL,
    PRIMARY KEY (guild_id, message_id, emoji)
  )`);
}

export function addReactionRole(guildId, messageId, channelId, emoji, roleId) {
  ensureTable();
  getDb().prepare("INSERT OR REPLACE INTO reaction_roles (guild_id, message_id, channel_id, emoji, role_id) VALUES (?, ?, ?, ?, ?)")
    .run(guildId, messageId, channelId, emoji, roleId);
}

export function removeReactionRole(guildId, messageId, emoji) {
  ensureTable();
  return getDb().prepare("DELETE FROM reaction_roles WHERE guild_id = ? AND message_id = ? AND emoji = ?").run(guildId, messageId, emoji).changes > 0;
}

export function getReactionRoles(guildId, messageId) {
  ensureTable();
  const rows = getDb().prepare("SELECT emoji, role_id FROM reaction_roles WHERE guild_id = ? AND message_id = ?").all(guildId, messageId);
  if (rows.length === 0) return null;
  const roles = {};
  for (const r of rows) roles[r.emoji] = r.role_id;
  return roles;
}

export function listAllReactionRoles(guildId) {
  ensureTable();
  const rows = getDb().prepare("SELECT message_id, channel_id, emoji, role_id FROM reaction_roles WHERE guild_id = ?").all(guildId);
  const result = {};
  for (const r of rows) {
    if (!result[r.message_id]) result[r.message_id] = { channelId: r.channel_id, roles: {} };
    result[r.message_id].roles[r.emoji] = r.role_id;
  }
  return result;
}

export async function handleReactionAdd(reaction, user) {
  if (user.bot) return;
  if (!reaction.message.guildId) return;
  const roles = getReactionRoles(reaction.message.guildId, reaction.message.id);
  if (!roles) return;
  const emojiKey = reaction.emoji.id ? `<:${reaction.emoji.name}:${reaction.emoji.id}>` : reaction.emoji.name;
  const roleId = roles[emojiKey] || roles[reaction.emoji.name];
  if (!roleId) return;
  try {
    const member = await reaction.message.guild.members.fetch(user.id);
    await member.roles.add(roleId);
  } catch (e) { console.error("Reaction role add failed:", e.message); }
}

export async function handleReactionRemove(reaction, user) {
  if (user.bot) return;
  if (!reaction.message.guildId) return;
  const roles = getReactionRoles(reaction.message.guildId, reaction.message.id);
  if (!roles) return;
  const emojiKey = reaction.emoji.id ? `<:${reaction.emoji.name}:${reaction.emoji.id}>` : reaction.emoji.name;
  const roleId = roles[emojiKey] || roles[reaction.emoji.name];
  if (!roleId) return;
  try {
    const member = await reaction.message.guild.members.fetch(user.id);
    await member.roles.remove(roleId);
  } catch (e) { console.error("Reaction role remove failed:", e.message); }
}
