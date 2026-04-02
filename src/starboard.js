import { getDb } from "./storage.js";

let _init = false;
function ensureTable() {
  if (_init) return;
  _init = true;
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS starboard_config (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    threshold INTEGER DEFAULT 3
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS starboard_posts (
    guild_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    starboard_message_id TEXT NOT NULL,
    PRIMARY KEY (guild_id, message_id)
  )`);
}

export function getStarboardConfig(guildId) {
  ensureTable();
  const row = getDb().prepare("SELECT channel_id, threshold FROM starboard_config WHERE guild_id = ?").get(guildId);
  return row ? { channelId: row.channel_id, threshold: row.threshold } : null;
}

export function setStarboardConfig(guildId, channelId, threshold = 3) {
  ensureTable();
  getDb().prepare("INSERT OR REPLACE INTO starboard_config (guild_id, channel_id, threshold) VALUES (?, ?, ?)").run(guildId, channelId, Math.max(1, threshold));
}

export function removeStarboardConfig(guildId) {
  ensureTable();
  const changes = getDb().prepare("DELETE FROM starboard_config WHERE guild_id = ?").run(guildId).changes;
  getDb().prepare("DELETE FROM starboard_posts WHERE guild_id = ?").run(guildId);
  return changes > 0;
}

export async function handleStarboardReaction(reaction, client) {
  if (reaction.partial) { try { await reaction.fetch(); } catch { return; } }
  if (reaction.emoji.name !== "\u2b50") return;
  const message = reaction.message;
  if (message.partial) { try { await message.fetch(); } catch { return; } }
  const guildId = message.guildId;
  if (!guildId) return;

  const config = getStarboardConfig(guildId);
  if (!config?.channelId) return;
  if (message.channelId === config.channelId) return;

  const starCount = message.reactions.cache.get("\u2b50")?.count || 0;
  if (starCount < config.threshold) return;

  ensureTable();
  const db = getDb();
  const existing = db.prepare("SELECT starboard_message_id FROM starboard_posts WHERE guild_id = ? AND message_id = ?").get(guildId, message.id);

  if (existing) {
    try {
      const sbChannel = await client.channels.fetch(config.channelId).catch(() => null);
      if (!sbChannel) return;
      const sbMsg = await sbChannel.messages.fetch(existing.starboard_message_id).catch(() => null);
      if (sbMsg) await sbMsg.edit({ content: `\u2b50 **${starCount}** | <#${message.channelId}>` }).catch(() => {});
    } catch {}
    return;
  }

  try {
    const sbChannel = await client.channels.fetch(config.channelId).catch(() => null);
    if (!sbChannel?.isTextBased()) return;
    const content = message.content?.slice(0, 1024) || "";
    const image = message.attachments?.first()?.url;
    const embed = {
      color: 0xfee75c,
      author: { name: message.author?.username || "Unknown", icon_url: message.author?.displayAvatarURL?.({ size: 64 }) },
      description: content || undefined,
      fields: [{ name: "Source", value: `[Jump to message](${message.url})`, inline: true }],
      image: image ? { url: image } : undefined,
      timestamp: message.createdAt?.toISOString(),
    };
    const sbMsg = await sbChannel.send({ content: `\u2b50 **${starCount}** | <#${message.channelId}>`, embeds: [embed] });
    db.prepare("INSERT OR REPLACE INTO starboard_posts (guild_id, message_id, starboard_message_id) VALUES (?, ?, ?)").run(guildId, message.id, sbMsg.id);
  } catch (e) { console.error("Starboard post failed:", e.message); }
}
