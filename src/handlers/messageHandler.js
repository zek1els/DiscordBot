import { list as listCustomCommands, get as getCustomCommand } from "../customCommands.js";
import { handleEconomyCommand, ECONOMY_COMMAND_NAMES } from "../economyCommands.js";
import { getConfig as getJailConfig, saveJailedRoles, popJailedRoles } from "../jailConfig.js";
import { awardMessageXp } from "../levels.js";
import { addWarning, getWarnings } from "../warnings.js";
import { log as auditLog } from "../auditLog.js";
import { handleMusicCommand, MUSIC_COMMANDS } from "../musicCommands.js";
import { handleFunCommand, FUN_COMMANDS } from "../funCommands.js";
import { handleUtilityCommand, UTILITY_COMMANDS } from "../utilityCommands.js";
import { handleAfkCheck, setAfk, getAfk } from "../afk.js";
import { createReminder, listReminders, cancelReminder, formatMs } from "../reminders.js";
import { createPoll } from "../polls.js";
import { startGiveaway, rerollGiveaway } from "../giveaways.js";
import { openTicket, closeTicket } from "../ticketSystem.js";
import { getSnipe, getEditSnipe } from "../snipe.js";
import { parseTime } from "../reminders.js";
import { sendModLog } from "../modLog.js";

// Timed jail auto-unjail timers
const jailTimers = new Map();

// Accept both ASCII "!" and fullwidth "！" (U+FF01) as custom-command prefix
const CUSTOM_CMD_PREFIXES = ["!", "\uFF01"];

// --- Anti-spam ---
const SPAM_THRESHOLD = 4;
const SPAM_WINDOW_MS = 30_000;
const JAIL_WARNING_THRESHOLD = 10;
const spamTracker = new Map();

function trackAndDetectSpam(guildId, channelId, userId, content, messageId) {
  const key = `${guildId}:${channelId}:${userId}`;
  const now = Date.now();

  if (!spamTracker.has(key)) spamTracker.set(key, []);
  const history = spamTracker.get(key);

  history.push({ content: content.toLowerCase(), time: now, id: messageId });

  while (history.length > 0 && now - history[0].time > SPAM_WINDOW_MS) {
    history.shift();
  }

  const matching = history.filter((h) => h.content === content.toLowerCase());
  if (matching.length >= SPAM_THRESHOLD) {
    const idsToDelete = matching.slice(1).map((h) => h.id).filter(Boolean);
    spamTracker.set(key, []);
    return idsToDelete;
  }

  return null;
}

async function autoJail(message, guildId) {
  const cfg = getJailConfig(guildId);
  if (!cfg?.criminalRoleId) return;
  try {
    const member = await message.guild.members.fetch(message.author.id);
    const currentRoleIds = member.roles.cache
      .filter((r) => r.id !== message.guild.id && r.id !== cfg.criminalRoleId)
      .map((r) => r.id);
    saveJailedRoles(guildId, message.author.id, currentRoleIds);
    const rolesToRemove = currentRoleIds.filter((id) => id !== cfg.criminalRoleId);
    if (rolesToRemove.length > 0) await member.roles.remove(rolesToRemove);
    await member.roles.add(cfg.criminalRoleId);
    auditLog(guildId, "jail", { userId: message.author.id, moderatorId: "auto-spam", reason: "Reached 10 warnings" });
  } catch (e) {
    console.error("Auto-jail failed:", e.message || e);
  }
}

/** @param {import("discord.js").Client} client */
let _client = null;
export function setClient(client) { _client = client; }

export async function handleMessage(message) {
  if (message.author?.bot) return;
  const raw = message.content;
  if (raw == null || typeof raw !== "string") return;
  const content = raw.trim();
  if (!content) return;

  const guildId = message.guildId ?? message.guild?.id;

  // AFK check (handles mention notifications and auto-remove)
  if (guildId) {
    await handleAfkCheck(message);
  }

  // Anti-spam check (only in guilds)
  if (guildId && message.channelId) {
    const spamIds = trackAndDetectSpam(guildId, message.channelId, message.author.id, content, message.id);
    if (spamIds && spamIds.length > 0) {
      try {
        await message.channel.bulkDelete(spamIds);
      } catch (bulkErr) {
        console.warn("bulkDelete failed, trying individual deletes:", bulkErr.message);
        for (const id of spamIds) {
          try {
            const msg = await message.channel.messages.fetch(id).catch(() => null);
            if (msg) await msg.delete();
          } catch (_) {}
        }
      }

      const { warning, total } = addWarning(guildId, message.author.id, "Auto-spam: repeated messages", "kova");
      auditLog(guildId, "warn", { userId: message.author.id, moderatorId: "kova", reason: "Auto-spam: repeated messages" });

      const warnEmbed = {
        color: 0xfee75c,
        description: `⚠️ <@${message.author.id}> — stop spamming. **Warning ${total}/10**`,
      };
      if (total >= JAIL_WARNING_THRESHOLD) {
        await autoJail(message, guildId);
        warnEmbed.description += `\n🔒 You have been **jailed** for reaching ${JAIL_WARNING_THRESHOLD} warnings.`;
        warnEmbed.color = 0xed4245;
      }
      message.channel.send({ embeds: [warnEmbed] }).catch(() => {});
      return;
    }
  }

  // XP award
  if (guildId) {
    const result = awardMessageXp(guildId, message.author.id);
    if (result?.leveledUp) {
      message.channel.send({
        embeds: [{
          color: 0x5865f2,
          description: `🎉 <@${message.author.id}> reached **Level ${result.newLevel}**!`,
        }],
      }).catch(() => {});
      auditLog(guildId, "level_up", { userId: message.author.id, level: result.newLevel });
    }
  }

  const firstChar = content.charAt(0);
  if (!CUSTOM_CMD_PREFIXES.includes(firstChar)) return;
  const afterPrefix = content.slice(1).trim();
  if (!afterPrefix) return;
  const firstSpace = afterPrefix.indexOf(" ");
  const commandName = (firstSpace === -1 ? afterPrefix : afterPrefix.slice(0, firstSpace)).toLowerCase().replace(/\s/g, "");
  const rest = firstSpace === -1 ? "" : afterPrefix.slice(firstSpace + 1).trim();

  // !help command
  if (commandName === "help" || commandName === "h") {
    const fields = [
      { name: "\u200b\n📖  General", value: "> `!help` `!ping` `!uptime` `!avatar` `!serverinfo` `!userinfo`", inline: false },
      { name: "💰  Economy", value: "> `!bal` `!d` `!w` `!j` `!ap` `!q`\n> `!cf` `!sl` `!bj` `!r` `!give` `!lb`\n> `!dep` `!with` `!s` `!b` `!inv` `!st`\n> *Type* `!eco` *for full details*", inline: true },
      { name: "⚖️  Moderation", value: "> `!jail @user [time]` `!unjail @user`\n> `!ticket` `!ticket close`\n> `/confess` `/modlog-setup`", inline: true },
      { name: "🎵  Music", value: "> `!play` `!skip` `!stop` `!queue`\n> `!np` `!pause` `!resume` `!loop`\n> `!volume` `!shuffle` `!remove`", inline: true },
      { name: "🎲  Fun", value: "> `!8ball` `!dice` `!rps` `!choose`\n> `!ship` `!rate` `!mock` `!roast`\n> `!hack` `!pp` `!iq` `!howgay`", inline: true },
      { name: "🔧  Utility", value: "> `!remind` `!reminders` `!poll`\n> `!giveaway` `!afk` `!snipe` `!esnipe`\n> `!banner` `!roleinfo` `!emojis`", inline: true },
    ];
    const customCmds = listCustomCommands(message.guild?.id);
    if (customCmds.length > 0) {
      const cmdList = customCmds.map((c) => `\`!${c.name}\``).join("  ");
      fields.push({ name: "⚡  Custom Commands", value: "> " + cmdList, inline: false });
    }
    await message.channel.send({ embeds: [{
      color: 0x5865f2,
      title: "✨   Kova — Command Reference",
      description: "Here's everything I can do! Use the commands below to get started.\nNeed detailed economy help? Just type `!eco`.",
      fields,
      footer: { text: "Kova  •  Most commands have short aliases  •  !eco for economy details" },
    }] }).catch(() => {});
    return;
  }

  // Music commands
  if (MUSIC_COMMANDS.has(commandName)) {
    try { await handleMusicCommand(message, commandName, rest); } catch (e) { console.error("Music command error:", e); }
    return;
  }

  // Economy commands
  if (ECONOMY_COMMAND_NAMES.has(commandName)) {
    try { await handleEconomyCommand(message, commandName, rest); } catch (e) { console.error("Economy command error:", e); }
    return;
  }

  // Fun commands
  if (FUN_COMMANDS.has(commandName)) {
    try { await handleFunCommand(message, commandName, rest); } catch (e) { console.error("Fun command error:", e); }
    return;
  }

  // Utility commands
  if (UTILITY_COMMANDS.has(commandName)) {
    try { await handleUtilityCommand(message, _client, commandName, rest); } catch (e) { console.error("Utility command error:", e); }
    return;
  }

  // --- Standalone commands ---

  // AFK
  if (commandName === "afk") {
    if (!guildId) return;
    setAfk(guildId, message.author.id, rest || "AFK");
    return message.channel.send({
      embeds: [{ color: 0x99aab5, description: `💤 <@${message.author.id}> is now AFK: ${rest || "AFK"}` }],
    }).catch(() => {});
  }

  // Reminders
  if (commandName === "remind" || commandName === "reminder") {
    const parts = rest.split(/\s+/);
    if (parts[0] === "cancel" && parts[1]) {
      const ok = cancelReminder(message.author.id, parts[1]);
      return message.channel.send({ content: ok ? "✅ Reminder cancelled." : "❌ Reminder not found." }).catch(() => {});
    }
    if (parts.length < 2) return message.channel.send({ content: "Usage: `!remind <time> <message>`\nExample: `!remind 30m check the oven`" }).catch(() => {});
    const timeStr = parts[0];
    const reminderMsg = parts.slice(1).join(" ");
    const result = createReminder(message.author.id, message.channelId, timeStr, reminderMsg);
    if (!result.ok) return message.channel.send({ content: `❌ ${result.error}` }).catch(() => {});
    return message.channel.send({
      embeds: [{
        color: 0x57f287,
        description: `⏰ Reminder set! I'll remind you <t:${Math.floor(result.fireAt / 1000)}:R>`,
        footer: { text: `ID: ${result.id} · Cancel with !remind cancel ${result.id}` },
      }],
    }).catch(() => {});
  }

  if (commandName === "reminders") {
    const list = listReminders(message.author.id);
    if (list.length === 0) return message.channel.send({ content: "You have no active reminders." }).catch(() => {});
    const lines = list.map((r) => `\`${r.id}\` — ${r.message.slice(0, 60)} (<t:${Math.floor(r.fireAt / 1000)}:R>)`);
    return message.channel.send({
      embeds: [{
        color: 0x5865f2,
        title: `⏰ Your Reminders (${list.length})`,
        description: lines.join("\n"),
        footer: { text: "Cancel with !remind cancel <id>" },
      }],
    }).catch(() => {});
  }

  // Polls
  if (commandName === "poll") {
    return createPoll(message, rest);
  }

  // Giveaways
  if (commandName === "giveaway" || commandName === "gw") {
    if (rest.startsWith("reroll ")) {
      return rerollGiveaway(message, rest.slice(7).trim());
    }
    return startGiveaway(message, rest);
  }

  // Tickets
  if (commandName === "ticket") {
    if (rest.toLowerCase() === "close") return closeTicket(message);
    return openTicket(message, rest);
  }

  // Snipe
  if (commandName === "snipe") {
    const entry = getSnipe(message.channelId);
    if (!entry) return message.channel.send({ content: "Nothing to snipe!" }).catch(() => {});
    return message.channel.send({
      embeds: [{
        color: 0xed4245,
        author: { name: entry.author.username, icon_url: entry.author.avatarURL },
        description: entry.content || "*(no text)*",
        image: entry.attachmentURL ? { url: entry.attachmentURL } : undefined,
        footer: { text: `Deleted ${Math.floor((Date.now() - entry.timestamp) / 1000)}s ago` },
      }],
    }).catch(() => {});
  }

  if (commandName === "esnipe" || commandName === "editsnipe") {
    const entry = getEditSnipe(message.channelId);
    if (!entry) return message.channel.send({ content: "Nothing to edit-snipe!" }).catch(() => {});
    return message.channel.send({
      embeds: [{
        color: 0xfee75c,
        author: { name: entry.author.username, icon_url: entry.author.avatarURL },
        fields: [
          { name: "Before", value: entry.oldContent.slice(0, 1024) },
          { name: "After", value: entry.newContent.slice(0, 1024) },
        ],
        footer: { text: `Edited ${Math.floor((Date.now() - entry.timestamp) / 1000)}s ago` },
      }],
    }).catch(() => {});
  }

  // Built-in: !jail @user and !unjail @user
  if (commandName === "jail" || commandName === "unjail") {
    if (!guildId) return;
    const cfg = getJailConfig(guildId);
    if (!cfg) return message.channel.send({ content: "Jail not configured. An admin must run `/jail-setup` first." }).catch(() => {});
    const invoker = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
    if (!invoker) return;
    const hasAllowedRole = cfg.allowedRoleIds?.length > 0
      ? cfg.allowedRoleIds.some((id) => invoker.roles.cache.has(id))
      : invoker.permissions?.has("ManageRoles");
    if (!hasAllowedRole) {
      return message.channel.send({ content: "You don't have permission to use this command." }).catch(() => {});
    }
    const mentionedUsers = message.mentions?.users ? Array.from(message.mentions.users.values()) : [];
    const target = mentionedUsers[0];
    if (!target) return message.channel.send({ content: `Usage: \`!${commandName} @user [duration]\`\nExample: \`!jail @user 30m\`` }).catch(() => {});

    // Parse optional duration for timed jail (e.g. !jail @user 30m)
    const durationArg = rest.replace(/<@!?\d+>/g, "").trim().split(/\s+/)[0];
    let durationMs = null;
    let durationLabel = null;
    if (commandName === "jail" && durationArg) {
      durationMs = parseTime(durationArg);
      if (durationMs) {
        const MAX_JAIL_MS = 28 * 24 * 60 * 60 * 1000; // 28 days max
        if (durationMs > MAX_JAIL_MS) durationMs = MAX_JAIL_MS;
        durationLabel = formatMs(durationMs);
      }
    }

    try {
      const member = await message.guild.members.fetch(target.id);
      if (commandName === "jail") {
        const currentRoleIds = member.roles.cache
          .filter((r) => r.id !== message.guild.id && r.id !== cfg.criminalRoleId)
          .map((r) => r.id);
        saveJailedRoles(message.guild.id, target.id, currentRoleIds);
        const rolesToRemove = currentRoleIds.filter((id) => id !== cfg.criminalRoleId);
        if (rolesToRemove.length > 0) await member.roles.remove(rolesToRemove);
        if (cfg.criminalRoleId) await member.roles.add(cfg.criminalRoleId);

        const timeMsg = durationLabel ? ` for **${durationLabel}**` : "";
        await message.channel.send({
          embeds: [{
            color: 0xed4245,
            description: `🔒 <@${target.id}> has been jailed${timeMsg}.`,
          }],
        });
        auditLog(guildId, "jail", { userId: target.id, moderatorId: message.author.id });
        sendModLog(_client, guildId, "jail", {
          userId: target.id,
          moderatorId: message.author.id,
          duration: durationLabel || "Permanent",
        });

        // Set auto-unjail timer if duration specified
        if (durationMs) {
          const timerKey = `${guildId}:${target.id}`;
          // Clear existing timer if any
          if (jailTimers.has(timerKey)) clearTimeout(jailTimers.get(timerKey));
          const timer = setTimeout(async () => {
            jailTimers.delete(timerKey);
            try {
              const m = await message.guild.members.fetch(target.id);
              if (cfg.criminalRoleId) await m.roles.remove(cfg.criminalRoleId);
              const saved = popJailedRoles(guildId, target.id);
              if (saved && saved.length > 0) await m.roles.add(saved);
              else if (cfg.memberRoleId) await m.roles.add(cfg.memberRoleId);
              message.channel.send({
                embeds: [{ color: 0x57f287, description: `🔓 <@${target.id}> has been automatically unjailed (${durationLabel} elapsed).` }],
              }).catch(() => {});
              auditLog(guildId, "unjail", { userId: target.id, moderatorId: "auto-timer" });
              sendModLog(_client, guildId, "unjail", { userId: target.id, moderatorId: "auto-timer", reason: `Auto-unjail after ${durationLabel}` });
            } catch (e) {
              console.error("Auto-unjail failed:", e.message);
            }
          }, durationMs);
          jailTimers.set(timerKey, timer);
        }
      } else {
        // Clear any pending auto-unjail timer
        const timerKey = `${guildId}:${target.id}`;
        if (jailTimers.has(timerKey)) {
          clearTimeout(jailTimers.get(timerKey));
          jailTimers.delete(timerKey);
        }
        if (cfg.criminalRoleId) await member.roles.remove(cfg.criminalRoleId);
        const savedRoles = popJailedRoles(message.guild.id, target.id);
        if (savedRoles && savedRoles.length > 0) {
          await member.roles.add(savedRoles);
        } else if (cfg.memberRoleId) {
          await member.roles.add(cfg.memberRoleId);
        }
        await message.channel.send({
          embeds: [{ color: 0x57f287, description: `🔓 <@${target.id}> has been released from jail.` }],
        });
        auditLog(guildId, "unjail", { userId: target.id, moderatorId: message.author.id });
        sendModLog(_client, guildId, "unjail", { userId: target.id, moderatorId: message.author.id });
      }
    } catch (e) {
      console.error("Jail role update failed:", e);
      await message.channel.send({ content: `Failed to update roles: ${e.message || e}\nMake sure the bot has **Manage Roles** permission and its role is **above** the member/criminal roles in the role list.` }).catch(() => {});
    }
    return;
  }

  // Custom commands (last priority)
  const cmd = getCustomCommand(commandName, message.guild?.id);
  if (!cmd) return;
  const author = message.author;
  const mentionedUsers = message.mentions?.users ? Array.from(message.mentions.users.values()) : [];
  const target = mentionedUsers[0] ?? null;
  const replacements = {
    "{author}": author ? `<@${author.id}>` : "someone",
    "{author_username}": author?.displayName ?? author?.username ?? "someone",
    "{target}": target ? `<@${target.id}>` : "",
    "{target_username}": target ? (target.displayName ?? target.username) : "",
    "{args}": rest,
  };
  let text = cmd.template;
  for (const [key, value] of Object.entries(replacements)) {
    text = text.split(key).join(value);
  }
  if (!text.trim()) return;
  try {
    await message.channel.send({ content: text.trim() });
  } catch (e) {
    console.error("Custom command reply failed (check bot has 'Send Messages' in this channel):", e.message || e);
  }
}
