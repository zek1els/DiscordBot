import { getDb } from "./storage.js";
import { ChannelType, PermissionFlagsBits } from "discord.js";

let _init = false;
function ensureTable() {
  if (_init) return;
  _init = true;
  getDb().exec(`CREATE TABLE IF NOT EXISTS ticket_config (
    guild_id TEXT PRIMARY KEY,
    category_id TEXT,
    support_role_id TEXT,
    log_channel_id TEXT
  )`);
}

export function getTicketConfig(guildId) {
  ensureTable();
  const row = getDb().prepare("SELECT * FROM ticket_config WHERE guild_id = ?").get(guildId);
  if (!row) return null;
  return { categoryId: row.category_id, supportRoleId: row.support_role_id, logChannelId: row.log_channel_id };
}

export function setTicketConfig(guildId, categoryId, supportRoleId, logChannelId) {
  ensureTable();
  getDb().prepare("INSERT OR REPLACE INTO ticket_config (guild_id, category_id, support_role_id, log_channel_id) VALUES (?, ?, ?, ?)")
    .run(guildId, categoryId, supportRoleId || null, logChannelId || null);
}

export async function openTicket(message, reason) {
  const guildId = message.guildId;
  if (!guildId) return;
  const config = getTicketConfig(guildId);
  if (!config?.categoryId) {
    return message.channel.send({ content: "Ticket system not configured. An admin must run `/ticket-setup` first." }).catch(() => {});
  }
  const ticketName = `ticket-${message.author.username.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
  const existing = message.guild.channels.cache.find((c) => c.name === ticketName && c.parentId === config.categoryId);
  if (existing) return message.channel.send({ content: `You already have an open ticket: <#${existing.id}>` }).catch(() => {});

  try {
    const permissionOverwrites = [
      { id: message.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: message.author.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
    ];
    if (config.supportRoleId) permissionOverwrites.push({ id: config.supportRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });

    const channel = await message.guild.channels.create({
      name: ticketName, type: ChannelType.GuildText, parent: config.categoryId, permissionOverwrites,
      topic: `Ticket by ${message.author.username} | ${reason || "No reason provided"}`,
    });
    await channel.send({
      embeds: [{
        color: 0x5865f2, title: "\ud83c\udfab Ticket Opened",
        description: `**Opened by:** <@${message.author.id}>\n**Reason:** ${reason || "No reason provided"}\n\nUse \`!ticket close\` to close this ticket.\n${config.supportRoleId ? `<@&${config.supportRoleId}> will be with you shortly.` : "A staff member will be with you shortly."}`,
        timestamp: new Date().toISOString(),
      }],
    });
    await message.channel.send({ embeds: [{ color: 0x57f287, description: `\ud83c\udfab Ticket created: <#${channel.id}>` }] }).catch(() => {});
  } catch (e) {
    console.error("Ticket creation failed:", e);
    message.channel.send({ content: `Failed to create ticket: ${e.message}` }).catch(() => {});
  }
}

export async function closeTicket(message) {
  const guildId = message.guildId;
  if (!guildId) return;
  const config = getTicketConfig(guildId);
  const channel = message.channel;
  if (!channel.name.startsWith("ticket-")) return message.channel.send({ content: "This is not a ticket channel." }).catch(() => {});

  try {
    await channel.send({ embeds: [{ color: 0xed4245, description: `\ud83d\udd12 Ticket closed by <@${message.author.id}>. This channel will be deleted in 5 seconds.` }] });
    if (config?.logChannelId) {
      try {
        const logChannel = await message.guild.channels.fetch(config.logChannelId).catch(() => null);
        if (logChannel?.isTextBased()) {
          const messages = await channel.messages.fetch({ limit: 100 });
          const transcript = messages.reverse().map((m) => `[${m.createdAt.toISOString()}] ${m.author?.username || "Unknown"}: ${m.content || "(embed/attachment)"}`).join("\n");
          await logChannel.send({
            embeds: [{ color: 0x99aab5, title: `\ud83c\udfab Ticket Closed: #${channel.name}`, description: `Closed by <@${message.author.id}>`, footer: { text: `${messages.size} messages` }, timestamp: new Date().toISOString() }],
            files: transcript.length > 0 ? [{ attachment: Buffer.from(transcript, "utf-8"), name: `${channel.name}-transcript.txt` }] : undefined,
          }).catch(() => {});
        }
      } catch {}
    }
    setTimeout(() => { channel.delete("Ticket closed").catch(() => {}); }, 5000);
  } catch (e) { message.channel.send({ content: `Failed to close ticket: ${e.message}` }).catch(() => {}); }
}
