import { getLogChannelIdsForGuild } from "../deletedLogConfig.js";

const RED = 0xed4245;
const YELLOW = 0xfee75c;

async function resolveChannel(message, client) {
  if (message.channel?.name) return { name: message.channel.name, id: message.channelId };
  if (!message.channelId) return { name: "unknown", id: null };
  try {
    const ch = await client.channels.fetch(message.channelId).catch(() => null);
    return { name: ch?.name ?? "unknown", id: message.channelId };
  } catch {
    return { name: "unknown", id: message.channelId };
  }
}

function authorField(user) {
  if (!user) return "Unknown user";
  return `${user.tag || user.username || "Unknown"} (${user.id})`;
}

async function sendToLogChannels(guildId, embed, client) {
  const logChannelIds = getLogChannelIdsForGuild(guildId);
  if (logChannelIds.length === 0) return;
  for (const channelId of logChannelIds) {
    try {
      const logChannel = await client.channels.fetch(channelId).catch(() => null);
      if (logChannel?.isTextBased()) await logChannel.send({ embeds: [embed] });
    } catch (e) {
      console.error("Log send failed for channel", channelId, e);
    }
  }
}

export async function handleMessageDelete(message, client) {
  if (message.author?.bot) return;
  const guildId = message.guildId ?? message.guild?.id;
  if (!guildId) return;

  const ch = await resolveChannel(message, client);
  const content = message.content?.trim() || "(no text / message not cached)";
  const preview = content.length > 1024 ? content.slice(0, 1021) + "…" : content;

  const embed = {
    color: RED,
    author: {
      name: "Message Deleted",
    },
    fields: [
      { name: "Author", value: message.author ? `<@${message.author.id}>` : "Unknown", inline: true },
      { name: "Channel", value: ch.id ? `<#${ch.id}>` : `# ${ch.name}`, inline: true },
      { name: "Content", value: preview },
    ],
    footer: {
      text: message.author ? `${message.author.username} (${message.author.id})` : "Unknown user",
      icon_url: message.author?.displayAvatarURL?.({ size: 32 }) || undefined,
    },
    timestamp: new Date().toISOString(),
  };

  await sendToLogChannels(guildId, embed, client);
}

export async function handleMessageUpdate(oldMessage, newMessage, client) {
  if (newMessage.author?.bot) return;
  const guildId = newMessage.guildId ?? newMessage.guild?.id;
  if (!guildId) return;

  const oldContent = oldMessage.content?.trim();
  const newContent = newMessage.content?.trim();
  if (!oldContent || !newContent) return;
  if (oldContent === newContent) return;

  const ch = await resolveChannel(newMessage, client);
  const oldPreview = oldContent.length > 1024 ? oldContent.slice(0, 1021) + "…" : oldContent;
  const newPreview = newContent.length > 1024 ? newContent.slice(0, 1021) + "…" : newContent;

  const embed = {
    color: YELLOW,
    author: {
      name: "Message Edited",
    },
    fields: [
      { name: "Author", value: newMessage.author ? `<@${newMessage.author.id}>` : "Unknown", inline: true },
      { name: "Channel", value: ch.id ? `<#${ch.id}>` : `# ${ch.name}`, inline: true },
      { name: "Old Content", value: oldPreview },
      { name: "New Content", value: newPreview },
    ],
    footer: {
      text: newMessage.author ? `${newMessage.author.username} (${newMessage.author.id})` : "Unknown user",
      icon_url: newMessage.author?.displayAvatarURL?.({ size: 32 }) || undefined,
    },
    timestamp: new Date().toISOString(),
  };

  await sendToLogChannels(guildId, embed, client);
}
