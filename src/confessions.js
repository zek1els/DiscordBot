import { createStore } from "./dataDir.js";

const store = createStore("confessions");

/**
 * Get confession config for a guild.
 * @returns {{ channelId: string } | null}
 */
export function getConfessionConfig(guildId) {
  return store.get(guildId) || null;
}

/**
 * Set the confessions channel for a guild.
 */
export function setConfessionChannel(guildId, channelId) {
  store.set(guildId, { channelId });
}

/**
 * Disable confessions for a guild.
 */
export function disableConfessions(guildId) {
  store.delete(guildId);
}

let confessionCounter = new Map();

/**
 * Post an anonymous confession.
 * @param {import("discord.js").Client} client
 * @param {string} guildId
 * @param {string} text
 * @returns {{ ok: boolean, error?: string }}
 */
export async function postConfession(client, guildId, text) {
  const cfg = getConfessionConfig(guildId);
  if (!cfg) return { ok: false, error: "Confessions are not set up. An admin must run `/confess-setup`." };

  const channel = await client.channels.fetch(cfg.channelId).catch(() => null);
  if (!channel) return { ok: false, error: "Confession channel not found. Ask an admin to reconfigure." };

  const count = (confessionCounter.get(guildId) || 0) + 1;
  confessionCounter.set(guildId, count);

  await channel.send({
    embeds: [{
      color: 0x2f3136,
      author: { name: `Anonymous Confession #${count}` },
      description: text,
      footer: { text: "Use /confess to submit your own" },
      timestamp: new Date().toISOString(),
    }],
  });

  return { ok: true };
}
