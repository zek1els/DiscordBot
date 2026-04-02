import { getDb } from "./storage.js";
import { ChannelType, PermissionFlagsBits } from "discord.js";

let _init = false;
function ensureTable() {
  if (_init) return;
  _init = true;
  getDb().exec(`CREATE TABLE IF NOT EXISTS temp_voice_config (
    guild_id TEXT PRIMARY KEY,
    creator_channel_id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    name_template TEXT DEFAULT '{user}''s Channel'
  )`);
}

const activeChannels = new Map();

export function getTempVoiceConfig(guildId) {
  ensureTable();
  const row = getDb().prepare("SELECT * FROM temp_voice_config WHERE guild_id = ?").get(guildId);
  if (!row) return null;
  return { creatorChannelId: row.creator_channel_id, categoryId: row.category_id, nameTemplate: row.name_template };
}

export function setTempVoiceConfig(guildId, creatorChannelId, categoryId, nameTemplate = "{user}'s Channel") {
  ensureTable();
  getDb().prepare("INSERT OR REPLACE INTO temp_voice_config (guild_id, creator_channel_id, category_id, name_template) VALUES (?, ?, ?, ?)")
    .run(guildId, creatorChannelId, categoryId, nameTemplate);
}

export function disableTempVoice(guildId) {
  ensureTable();
  getDb().prepare("DELETE FROM temp_voice_config WHERE guild_id = ?").run(guildId);
}

export function getTempChannelOwner(channelId) {
  return activeChannels.get(channelId) || null;
}

export async function handleVoiceUpdate(oldState, newState) {
  const guildId = newState.guild?.id || oldState.guild?.id;
  if (!guildId) return;
  const cfg = getTempVoiceConfig(guildId);
  if (!cfg) return;

  if (newState.channelId === cfg.creatorChannelId && newState.member) {
    const name = cfg.nameTemplate.replace("{user}", newState.member.displayName);
    try {
      const channel = await newState.guild.channels.create({
        name, type: ChannelType.GuildVoice, parent: cfg.categoryId,
        permissionOverwrites: [{ id: newState.member.id, allow: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.Connect] }],
      });
      activeChannels.set(channel.id, { ownerId: newState.member.id, guildId });
      await newState.member.voice.setChannel(channel);
    } catch (e) { console.error("Temp voice create failed:", e.message); }
  }

  if (oldState.channelId && activeChannels.has(oldState.channelId)) {
    const channel = oldState.guild.channels.cache.get(oldState.channelId);
    if (channel && channel.members.size === 0) {
      activeChannels.delete(oldState.channelId);
      try { await channel.delete("Temp voice channel empty"); } catch {}
    }
  }
}

export async function setTempChannelName(member, name) {
  const vc = member.voice?.channel;
  if (!vc || !activeChannels.has(vc.id)) return { ok: false, error: "You're not in a temp channel." };
  if (activeChannels.get(vc.id).ownerId !== member.id) return { ok: false, error: "You don't own this channel." };
  await vc.setName(name);
  return { ok: true };
}

export async function setTempChannelLimit(member, limit) {
  const vc = member.voice?.channel;
  if (!vc || !activeChannels.has(vc.id)) return { ok: false, error: "You're not in a temp channel." };
  if (activeChannels.get(vc.id).ownerId !== member.id) return { ok: false, error: "You don't own this channel." };
  await vc.setUserLimit(limit);
  return { ok: true };
}

export async function lockTempChannel(member, lock) {
  const vc = member.voice?.channel;
  if (!vc || !activeChannels.has(vc.id)) return { ok: false, error: "You're not in a temp channel." };
  if (activeChannels.get(vc.id).ownerId !== member.id) return { ok: false, error: "You don't own this channel." };
  await vc.permissionOverwrites.edit(member.guild.id, { Connect: !lock });
  return { ok: true };
}
