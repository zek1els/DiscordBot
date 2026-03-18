import { getLogChannelIdsForGuild } from "../deletedLogConfig.js";

export async function handleMessageDelete(message, client) {
  if (message.author?.bot) return;
  const guildId = message.guildId ?? message.guild?.id;
  if (!guildId) return;
  const logChannelIds = getLogChannelIdsForGuild(guildId);
  if (logChannelIds.length === 0) return;
  let channelName = message.channel?.name;
  if (channelName == null && message.channelId) {
    try {
      const ch = await client.channels.fetch(message.channelId).catch(() => null);
      channelName = ch?.name ?? "unknown";
    } catch (e) {
      console.warn("Failed to fetch channel for delete log:", e.message);
      channelName = "unknown";
    }
  }
  channelName = channelName ?? "unknown";
  const author = message.author ? `${message.author.tag} (${message.author.id})` : "unknown user";
  const content = message.content?.trim() || "(no text / message not cached)";
  const preview = content.length > 400 ? content.slice(0, 400) + "…" : content;
  const text = `**Message deleted** in #${channelName}\n**Author:** ${author}\n**Content:**\n${preview}`;
  for (const channelId of logChannelIds) {
    try {
      const logChannel = await client.channels.fetch(channelId).catch(() => null);
      if (logChannel?.isTextBased()) await logChannel.send({ content: text });
    } catch (e) {
      console.error("Deleted-message log failed for channel", channelId, e);
    }
  }
}
