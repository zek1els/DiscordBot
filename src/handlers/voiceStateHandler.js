import { addVcMinutes } from "../levels.js";

const vcSessions = new Map();

export function handleVoiceStateUpdate(oldState, newState) {
  const userId = newState.member?.id || oldState.member?.id;
  if (!userId) return;
  const guildId = newState.guild?.id || oldState.guild?.id;
  if (!guildId) return;
  if (newState.member?.user?.bot) return;

  const key = `${guildId}:${userId}`;
  const wasInChannel = !!oldState.channelId && !oldState.member?.user?.bot;
  const isInChannel = !!newState.channelId;

  if (!wasInChannel && isInChannel) {
    vcSessions.set(key, Date.now());
  } else if (wasInChannel && !isInChannel) {
    const start = vcSessions.get(key);
    if (start) {
      const minutes = Math.floor((Date.now() - start) / 60_000);
      if (minutes > 0) addVcMinutes(guildId, userId, minutes);
      vcSessions.delete(key);
    }
  } else if (wasInChannel && isInChannel && oldState.channelId !== newState.channelId) {
    // Switched channels — keep tracking, no action needed
  }
}
