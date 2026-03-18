import { list as listCustomCommands, get as getCustomCommand } from "../customCommands.js";
import { handleEconomyCommand, ECONOMY_COMMAND_NAMES } from "../economyCommands.js";
import { getConfig as getJailConfig, saveJailedRoles, popJailedRoles } from "../jailConfig.js";
import { awardMessageXp } from "../levels.js";
import { addWarning, getWarnings } from "../warnings.js";
import { log as auditLog } from "../auditLog.js";

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

export async function handleMessage(message) {
  if (message.author?.bot) return;
  const raw = message.content;
  if (raw == null || typeof raw !== "string") return;
  const content = raw.trim();
  if (!content) return;

  const guildId = message.guildId ?? message.guild?.id;

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
      { name: "\u200b\n📖  General", value: "> `!help` / `!h` — Show this menu", inline: false },
      { name: "💰  Economy", value: "> `!bal` `!d` `!w` `!j` `!ap` `!q`\n> `!cf` `!sl` `!bj` `!r` `!give` `!lb`\n> `!dep` `!with` `!s` `!b` `!inv` `!st`\n> *Type* `!eco` *for full details*", inline: true },
      { name: "⚖️  Moderation", value: "> `!jail @user` — Jail a member\n> `!unjail @user` — Release a member", inline: true },
    ];
    const customCmds = listCustomCommands(message.guild?.id);
    if (customCmds.length > 0) {
      const cmdList = customCmds.map((c) => `\`!${c.name}\``).join(" \u2003 ");
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

  // Economy commands
  if (ECONOMY_COMMAND_NAMES.has(commandName)) {
    try {
      await handleEconomyCommand(message, commandName, rest);
    } catch (e) {
      console.error("Economy command error:", e);
    }
    return;
  }

  // Built-in: !jail @user and !unjail @user
  if (commandName === "jail" || commandName === "unjail") {
    const guildId = message.guildId ?? message.guild?.id;
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
    if (!target) return message.channel.send({ content: `Usage: \`!${commandName} @user\`` }).catch(() => {});
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
        await message.channel.send({ content: `<@${target.id}> has been jailed.` });
        auditLog(guildId, "jail", { userId: target.id, moderatorId: message.author.id });
      } else {
        if (cfg.criminalRoleId) await member.roles.remove(cfg.criminalRoleId);
        const savedRoles = popJailedRoles(message.guild.id, target.id);
        if (savedRoles && savedRoles.length > 0) {
          await member.roles.add(savedRoles);
        } else if (cfg.memberRoleId) {
          await member.roles.add(cfg.memberRoleId);
        }
        await message.channel.send({ content: `<@${target.id}> has been released from jail.` });
        auditLog(guildId, "unjail", { userId: target.id, moderatorId: message.author.id });
      }
    } catch (e) {
      console.error("Jail role update failed:", e);
      await message.channel.send({ content: `Failed to update roles: ${e.message || e}\nMake sure the bot has **Manage Roles** permission and its role is **above** the member/criminal roles in the role list.` }).catch(() => {});
    }
    return;
  }

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
