import { getDb } from "./storage.js";
import { randomBytes } from "crypto";
import { parseTime, formatMs } from "./reminders.js";
import { safeTimeout } from "./safeTimeout.js";

let _init = false;
function ensureTable() {
  if (_init) return;
  _init = true;
  getDb().exec(`CREATE TABLE IF NOT EXISTS giveaways (
    id TEXT PRIMARY KEY,
    message_id TEXT,
    channel_id TEXT,
    guild_id TEXT,
    prize TEXT,
    host_id TEXT,
    ends_at INTEGER,
    ended INTEGER DEFAULT 0,
    winner_id TEXT
  )`);
}

const giveawayTimers = new Map();
let discordClient = null;

export function initGiveaways(client) {
  discordClient = client;
  ensureTable();
  const db = getDb();
  const giveaways = db.prepare("SELECT * FROM giveaways WHERE ended = 0").all();
  const now = Date.now();
  for (const g of giveaways) {
    if (g.ends_at <= now) {
      endGiveaway(g.id);
    } else {
      scheduleEnd(g);
    }
  }
  console.log(`Giveaways: ${giveaways.length} active.`);
}

function scheduleEnd(g) {
  const delay = Math.max(1000, g.ends_at - Date.now());
  const handle = safeTimeout(() => endGiveaway(g.id), delay);
  giveawayTimers.set(g.id, handle);
}

export async function startGiveaway(message, args) {
  const parts = args.trim().split(/\s+/);
  if (parts.length < 2) return message.channel.send({ content: "Usage: `!giveaway <duration> <prize>`\nExample: `!giveaway 1h Free Nitro`" }).catch(() => {});
  const timeStr = parts[0];
  const ms = parseTime(timeStr);
  if (!ms || ms < 10_000) return message.channel.send({ content: "Invalid duration. Use: `30s`, `5m`, `2h`, `1d`" }).catch(() => {});
  if (ms > 14 * 86_400_000) return message.channel.send({ content: "Maximum giveaway duration is 14 days." }).catch(() => {});

  const prize = parts.slice(1).join(" ");
  const endsAt = Date.now() + ms;

  const msg = await message.channel.send({
    embeds: [{ color: 0xfee75c, title: "\ud83c\udf89 GIVEAWAY \ud83c\udf89", description: `**${prize}**\n\nReact with \ud83c\udf89 to enter!\nEnds: <t:${Math.floor(endsAt / 1000)}:R>`, footer: { text: `Hosted by ${message.author.username}` }, timestamp: new Date(endsAt).toISOString() }],
  }).catch(() => null);
  if (!msg) return;
  await msg.react("\ud83c\udf89").catch(() => {});

  ensureTable();
  const id = randomBytes(4).toString("hex");
  getDb().prepare("INSERT INTO giveaways (id, message_id, channel_id, guild_id, prize, host_id, ends_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, msg.id, message.channel.id, message.guildId, prize, message.author.id, endsAt);
  scheduleEnd({ id, ends_at: endsAt });
}

export async function endGiveaway(giveawayId) {
  ensureTable();
  const db = getDb();
  const g = db.prepare("SELECT * FROM giveaways WHERE id = ? AND ended = 0").get(giveawayId);
  if (!g) return;

  db.prepare("UPDATE giveaways SET ended = 1 WHERE id = ?").run(giveawayId);
  const timer = giveawayTimers.get(giveawayId);
  if (timer) { timer.clear(); giveawayTimers.delete(giveawayId); }
  if (!discordClient) return;

  try {
    const channel = await discordClient.channels.fetch(g.channel_id).catch(() => null);
    if (!channel) return;
    const msg = await channel.messages.fetch(g.message_id).catch(() => null);
    if (!msg) return;
    const reaction = msg.reactions.cache.get("\ud83c\udf89");
    if (!reaction) {
      await channel.send({ embeds: [{ color: 0xed4245, description: `\ud83c\udf89 Giveaway for **${g.prize}** ended \u2014 no participants!` }] }).catch(() => {});
      return;
    }
    const users = await reaction.users.fetch();
    const eligible = users.filter((u) => !u.bot);
    if (eligible.size === 0) {
      await channel.send({ embeds: [{ color: 0xed4245, description: `\ud83c\udf89 Giveaway for **${g.prize}** ended \u2014 no participants!` }] }).catch(() => {});
      return;
    }
    const winner = eligible.random();
    db.prepare("UPDATE giveaways SET winner_id = ? WHERE id = ?").run(winner.id, giveawayId);
    await msg.edit({ embeds: [{ color: 0x57f287, title: "\ud83c\udf89 GIVEAWAY ENDED \ud83c\udf89", description: `**${g.prize}**\n\nWinner: <@${winner.id}> \ud83c\udf8a`, footer: { text: `${eligible.size} participant(s)` } }] }).catch(() => {});
    await channel.send({ content: `<@${winner.id}>`, embeds: [{ color: 0x57f287, description: `\ud83c\udf89 Congratulations <@${winner.id}>! You won **${g.prize}**!` }] }).catch(() => {});
  } catch (e) { console.error("Giveaway end failed:", e.message); }
}

export async function rerollGiveaway(message, messageId) {
  ensureTable();
  const db = getDb();
  const g = db.prepare("SELECT * FROM giveaways WHERE message_id = ? AND guild_id = ?").get(messageId, message.guildId);
  if (!g) return message.channel.send({ content: "Giveaway not found." }).catch(() => {});
  if (!g.ended) return message.channel.send({ content: "This giveaway hasn't ended yet." }).catch(() => {});

  try {
    const channel = await discordClient.channels.fetch(g.channel_id).catch(() => null);
    if (!channel) return;
    const msg = await channel.messages.fetch(g.message_id).catch(() => null);
    if (!msg) return message.channel.send({ content: "Original giveaway message not found." }).catch(() => {});
    const reaction = msg.reactions.cache.get("\ud83c\udf89");
    const users = reaction ? await reaction.users.fetch() : null;
    const eligible = users?.filter((u) => !u.bot);
    if (!eligible || eligible.size === 0) return message.channel.send({ content: "No eligible participants to reroll." }).catch(() => {});
    const winner = eligible.random();
    db.prepare("UPDATE giveaways SET winner_id = ? WHERE id = ?").run(winner.id, g.id);
    await message.channel.send({ content: `<@${winner.id}>`, embeds: [{ color: 0x57f287, description: `\ud83c\udf89 New winner: <@${winner.id}> wins **${g.prize}**!` }] }).catch(() => {});
  } catch (e) { return message.channel.send({ content: `Error: ${e.message}` }).catch(() => {}); }
}
