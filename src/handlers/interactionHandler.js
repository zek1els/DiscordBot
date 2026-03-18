import { getMessageOptionsFromInteraction } from "../commands.js";
import { buildMessagePayload, hasMessageContent } from "../embedBuilder.js";
import { save as saveMessage, get as getSavedMessage, list as listSavedMessages, remove as removeSavedMessage } from "../savedMessages.js";
import { addLogChannel, removeLogChannel } from "../deletedLogConfig.js";
import { getConfig as getJailConfig, setConfig as setJailConfig } from "../jailConfig.js";
import { addSchedule, listSchedules, removeSchedule } from "../scheduler.js";
import { getStats, getLeaderboard } from "../levels.js";
import { addWarning, getWarnings, clearWarnings } from "../warnings.js";
import { log as auditLog } from "../auditLog.js";
import { setStarboardConfig, removeStarboardConfig, getStarboardConfig } from "../starboard.js";
import { setWelcomeMessage, setLeaveMessage, disableWelcome, disableLeave } from "../welcomeConfig.js";
import { setTicketConfig } from "../ticketSystem.js";
import { setConfessionChannel, disableConfessions, postConfession } from "../confessions.js";
import { setModLogChannel, disableModLog } from "../modLog.js";

export async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return;

  // --- /level ---
  if (interaction.commandName === "level") {
    const user = interaction.options.getUser("user") || interaction.user;
    const guildId = interaction.guildId;
    if (!guildId) return interaction.reply({ content: "Use this in a server.", ephemeral: true });
    const stats = getStats(guildId, user.id);
    const barLength = 14;
    const filled = Math.round((stats.currentXp / stats.neededXp) * barLength);
    const bar = "▓".repeat(filled) + "░".repeat(barLength - filled);
    return interaction.reply({
      embeds: [{
        color: 0x5865f2,
        author: { name: user.tag || user.username, icon_url: user.displayAvatarURL({ size: 64 }) },
        fields: [
          { name: "Level", value: `**${stats.level}**`, inline: true },
          { name: "Total XP", value: `**${stats.xp.toLocaleString()}**`, inline: true },
          { name: "Progress", value: `${bar} ${stats.currentXp}/${stats.neededXp} XP`, inline: false },
          { name: "Messages", value: stats.totalMessages.toLocaleString(), inline: true },
          { name: "VC Time", value: `${stats.vcMinutes} min`, inline: true },
        ],
      }],
    });
  }

  // --- /leaderboard ---
  if (interaction.commandName === "leaderboard") {
    const guildId = interaction.guildId;
    if (!guildId) return interaction.reply({ content: "Use this in a server.", ephemeral: true });
    const type = interaction.options.getString("type") || "xp";
    const lb = getLeaderboard(guildId, type, 15);
    if (lb.length === 0) return interaction.reply({ content: "No data yet. Start chatting!", ephemeral: true });

    const medals = ["🥇", "🥈", "🥉"];
    const title = { xp: "XP Leaderboard", messages: "Message Leaderboard", vc: "Voice Chat Leaderboard" }[type];
    const lines = lb.map((e, i) => {
      const prefix = medals[i] || `**${i + 1}.**`;
      const member = interaction.guild.members.cache.get(e.userId);
      const name = member?.displayName || `<@${e.userId}>`;
      const value = type === "xp" ? `${e.xp.toLocaleString()} XP (Lv ${e.level})`
        : type === "messages" ? `${e.totalMessages.toLocaleString()} messages`
        : `${e.vcMinutes.toLocaleString()} minutes`;
      return `${prefix} ${name} — ${value}`;
    });

    return interaction.reply({
      embeds: [{
        color: 0x5865f2,
        title: `📊 ${title}`,
        description: lines.join("\n"),
        footer: { text: `${interaction.guild.name}` },
      }],
    });
  }

  // --- /warn ---
  if (interaction.commandName === "warn") {
    if (!interaction.memberPermissions?.has("ModerateMembers")) {
      return interaction.reply({ content: "You need **Moderate Members** permission to use this.", ephemeral: true });
    }
    const user = interaction.options.getUser("user");
    const reason = interaction.options.getString("reason");
    const guildId = interaction.guildId;
    if (!guildId) return interaction.reply({ content: "Use this in a server.", ephemeral: true });
    const { warning, total } = addWarning(guildId, user.id, reason, interaction.user.id);
    auditLog(guildId, "warn", { userId: user.id, moderatorId: interaction.user.id, reason });
    return interaction.reply({
      embeds: [{
        color: 0xfee75c,
        title: "⚠️ Warning Issued",
        fields: [
          { name: "User", value: `<@${user.id}>`, inline: true },
          { name: "Moderator", value: `<@${interaction.user.id}>`, inline: true },
          { name: "Reason", value: reason },
          { name: "Total Warnings", value: `${total}`, inline: true },
        ],
        footer: { text: `ID: ${warning.id}` },
        timestamp: new Date().toISOString(),
      }],
    });
  }

  // --- /warnings ---
  if (interaction.commandName === "warnings") {
    const user = interaction.options.getUser("user");
    const guildId = interaction.guildId;
    if (!guildId) return interaction.reply({ content: "Use this in a server.", ephemeral: true });
    const warns = getWarnings(guildId, user.id);
    if (warns.length === 0) {
      return interaction.reply({ content: `<@${user.id}> has no warnings.`, ephemeral: true });
    }
    const lines = warns.map((w, i) => {
      const date = new Date(w.timestamp).toLocaleDateString();
      return `**${i + 1}.** ${w.reason}\n   Mod: <@${w.moderatorId}> · ${date} · ID: \`${w.id}\``;
    });
    return interaction.reply({
      embeds: [{
        color: 0xfee75c,
        title: `⚠️ Warnings for ${user.tag || user.username}`,
        description: lines.join("\n\n"),
        footer: { text: `${warns.length} warning(s)` },
      }],
      ephemeral: true,
    });
  }

  // --- /clearwarnings ---
  if (interaction.commandName === "clearwarnings") {
    if (!interaction.memberPermissions?.has("ModerateMembers")) {
      return interaction.reply({ content: "You need **Moderate Members** permission to use this.", ephemeral: true });
    }
    const user = interaction.options.getUser("user");
    const guildId = interaction.guildId;
    if (!guildId) return interaction.reply({ content: "Use this in a server.", ephemeral: true });
    const count = clearWarnings(guildId, user.id);
    auditLog(guildId, "clear_warnings", { userId: user.id, moderatorId: interaction.user.id, count });
    return interaction.reply({
      content: `Cleared **${count}** warning(s) for <@${user.id}>.`,
    });
  }

  if (interaction.commandName === "jail-setup") {
    if (!interaction.memberPermissions?.has("ManageRoles")) {
      return interaction.reply({ content: "You need **Manage Roles** permission to use this.", ephemeral: true });
    }
    const memberRole = interaction.options.getRole("member_role");
    const criminalRole = interaction.options.getRole("criminal_role");
    if (!memberRole || !criminalRole) {
      return interaction.reply({ content: "Both roles are required.", ephemeral: true });
    }
    const allowedRoles = [
      interaction.options.getRole("allowed_role_1"),
      interaction.options.getRole("allowed_role_2"),
      interaction.options.getRole("allowed_role_3"),
    ].filter(Boolean);
    const allowedRoleIds = allowedRoles.map((r) => r.id);
    try {
      setJailConfig(interaction.guildId, memberRole.id, criminalRole.id, allowedRoleIds);
      const allowedText = allowedRoles.length > 0
        ? `\n**Allowed roles:** ${allowedRoles.map((r) => r.name).join(", ")}`
        : "\n**Allowed roles:** Anyone with Manage Roles permission";
      return interaction.reply({
        content: `Jail configured.\n**Member role:** ${memberRole.name} (given to all new members)\n**Criminal role:** ${criminalRole.name} (given when jailed)${allowedText}\n\nUse \`!jail @user\` to jail and \`!unjail @user\` to release.\nRun \`/jail-assign-all\` to give the member role to everyone currently in the server.`,
        ephemeral: false,
      });
    } catch (e) {
      return interaction.reply({ content: "Failed to save jail config.", ephemeral: true });
    }
  }

  if (interaction.commandName === "jail-assign-all") {
    if (!interaction.memberPermissions?.has("ManageRoles")) {
      return interaction.reply({ content: "You need **Manage Roles** permission to use this.", ephemeral: true });
    }
    const cfg = getJailConfig(interaction.guildId);
    if (!cfg?.memberRoleId) {
      return interaction.reply({ content: "Jail not configured. Run `/jail-setup` first.", ephemeral: true });
    }
    await interaction.deferReply();
    try {
      const members = await interaction.guild.members.fetch();
      let assigned = 0;
      for (const [, member] of members) {
        if (member.user.bot) continue;
        if (member.roles.cache.has(cfg.memberRoleId)) continue;
        if (cfg.criminalRoleId && member.roles.cache.has(cfg.criminalRoleId)) continue;
        try {
          await member.roles.add(cfg.memberRoleId);
          assigned++;
        } catch (e) {
          console.warn(`Failed to assign member role to ${member.user?.tag}:`, e.message);
        }
      }
      await interaction.editReply({ content: `Done. Assigned the member role to **${assigned}** member(s). Members who are jailed (have the criminal role) were skipped.` });
    } catch (e) {
      await interaction.editReply({ content: "Failed. Make sure the bot has Manage Roles permission and its role is above the member role." });
    }
    return;
  }

  if (interaction.commandName === "log-deletes") {
    const sub = interaction.options.getSubcommand();
    const channel = interaction.channel;
    const guildId = interaction.guildId;
    if (!channel || !guildId) {
      return interaction.reply({ content: "This command must be used in a server channel.", ephemeral: true });
    }
    if (sub === "here") {
      try {
        addLogChannel(channel.id, guildId);
        return interaction.reply({
        content: "Deleted message logs will be sent to this channel. The bot monitors every server it's in; logs for this server will appear here.",
        ephemeral: false,
      });
      } catch (e) {
        return interaction.reply({ content: "Failed to save. The bot may not have write access to its data directory.", ephemeral: true });
      }
    }
    if (sub === "off") {
      try {
        removeLogChannel(channel.id);
        return interaction.reply({ content: "Stopped sending deleted message logs to this channel.", ephemeral: false });
      } catch (e) {
        return interaction.reply({ content: "Failed to save.", ephemeral: true });
      }
    }
    return;
  }

  if (interaction.commandName === "schedule") {
    const sub = interaction.options.getSubcommand();
    if (sub === "create") {
      const channel = interaction.options.getChannel("channel");
      const savedMessageName = interaction.options.getString("saved_message");
      const scheduleType = interaction.options.getString("schedule_type");
      const minutes = interaction.options.getInteger("minutes");
      const time = interaction.options.getString("time");
      const dayOfWeek = interaction.options.getInteger("day_of_week");
      const timezone = interaction.options.getString("timezone") || "UTC";

      let payload;
      if (savedMessageName) {
        payload = getSavedMessage(savedMessageName);
        if (!payload) {
          return interaction.reply({
            content: `Saved message \`${savedMessageName}\` not found. Use \`/message list\` to see names.`,
            ephemeral: true,
          });
        }
      } else {
        const opts = getMessageOptionsFromInteraction(interaction);
        if (!hasMessageContent(opts)) {
          return interaction.reply({
            content: "Provide **saved_message** or at least **content** / **embed_title** / **embed_description**.",
            ephemeral: true,
          });
        }
        payload = buildMessagePayload(opts);
      }

      const options = { timezone };
      if (scheduleType === "interval_minutes") options.minutes = minutes ?? 1;
      if (scheduleType === "daily" || scheduleType === "weekly") options.time = time || "00:00";
      if (scheduleType === "weekly") options.day_of_week = dayOfWeek ?? 0;

      try {
        const { id, label } = addSchedule({
          channelId: channel.id,
          payload,
          scheduleType,
          options,
        });
        return interaction.reply({
          content: `Scheduled: **${label}** in ${channel}. Use \`/schedule list\` to see it. ID: \`${id}\`.`,
          ephemeral: true,
        });
      } catch (err) {
        console.error(err);
        return interaction.reply({
          content: `Failed to create schedule: ${err.message}`,
          ephemeral: true,
        });
      }
    }

    if (sub === "list") {
      const schedules = listSchedules();
      if (schedules.length === 0) {
        return interaction.reply({ content: "No scheduled messages.", ephemeral: true });
      }
      const lines = schedules.map(
        (s) => `• \`${s.id}\` — ${s.label}\n  Channel: <#${s.channelId}> — ${s.preview || "(embed)"}…`
      );
      return interaction.reply({
        content: `**Scheduled messages:**\n${lines.join("\n")}`,
        ephemeral: true,
      });
    }

    if (sub === "delete") {
      const id = interaction.options.getString("id").trim();
      const removed = removeSchedule(id);
      if (!removed) {
        return interaction.reply({
          content: `Schedule \`${id}\` not found. Use \`/schedule list\` to see IDs.`,
          ephemeral: true,
        });
      }
      return interaction.reply({ content: `Schedule \`${id}\` removed.`, ephemeral: true });
    }
    return;
  }

  if (interaction.commandName === "message") {
    const sub = interaction.options.getSubcommand();
    if (sub === "save") {
      const name = interaction.options.getString("name");
      const opts = getMessageOptionsFromInteraction(interaction);
      if (!hasMessageContent(opts)) {
        return interaction.reply({
          content: "Provide at least **content** or **embed_title** / **embed_description** (or author, footer, image, etc.).",
          ephemeral: true,
        });
      }
      try {
        const payload = buildMessagePayload(opts);
        saveMessage(name, payload);
        return interaction.reply({
          content: `Saved template \`${name}\`. Use \`/message send\` or \`/schedule create\` with saved_message \`${name}\`.`,
          ephemeral: true,
        });
      } catch (err) {
        return interaction.reply({
          content: `Failed to save: ${err.message}`,
          ephemeral: true,
        });
      }
    }
    if (sub === "send") {
      const channel = interaction.options.getChannel("channel");
      const name = interaction.options.getString("name");
      const payload = getSavedMessage(name);
      if (!payload) {
        return interaction.reply({
          content: `Saved message \`${name}\` not found. Use \`/message list\`.`,
          ephemeral: true,
        });
      }
      try {
        await channel.send(payload);
        return interaction.reply({
          content: `Sent \`${name}\` to ${channel}.`,
          ephemeral: true,
        });
      } catch (err) {
        return interaction.reply({
          content: `Failed to send: ${err.message}`,
          ephemeral: true,
        });
      }
    }
    if (sub === "list") {
      const items = listSavedMessages();
      if (items.length === 0) {
        return interaction.reply({ content: "No saved message templates.", ephemeral: true });
      }
      const lines = items.map((m) => `• \`${m.name}\` — ${m.preview}`);
      return interaction.reply({
        content: `**Saved templates:**\n${lines.join("\n")}`,
        ephemeral: true,
      });
    }
    if (sub === "delete") {
      const name = interaction.options.getString("name");
      const removed = removeSavedMessage(name);
      if (!removed) {
        return interaction.reply({
          content: `Template \`${name}\` not found.`,
          ephemeral: true,
        });
      }
      return interaction.reply({
        content: `Template \`${name}\` deleted.`,
        ephemeral: true,
      });
    }
    return;
  }

  // --- /purge ---
  if (interaction.commandName === "purge") {
    if (!interaction.memberPermissions?.has("ManageMessages")) {
      return interaction.reply({ content: "You need **Manage Messages** permission to use this.", ephemeral: true });
    }
    const amount = interaction.options.getInteger("amount");
    const targetUser = interaction.options.getUser("user");
    await interaction.deferReply({ ephemeral: true });
    try {
      let deleted;
      if (targetUser) {
        const fetched = await interaction.channel.messages.fetch({ limit: 100 });
        const filtered = fetched.filter((m) => m.author.id === targetUser.id).first(amount);
        deleted = await interaction.channel.bulkDelete(filtered, true);
      } else {
        deleted = await interaction.channel.bulkDelete(amount, true);
      }
      await interaction.editReply({ content: `Deleted **${deleted.size}** message(s).` });
    } catch (e) {
      console.error("Purge failed:", e);
      await interaction.editReply({ content: `Failed: ${e.message}` });
    }
    return;
  }

  // --- /starboard ---
  if (interaction.commandName === "starboard") {
    if (!interaction.memberPermissions?.has("ManageGuild")) {
      return interaction.reply({ content: "You need **Manage Server** permission.", ephemeral: true });
    }
    const sub = interaction.options.getSubcommand();
    if (sub === "setup") {
      const channel = interaction.options.getChannel("channel");
      const threshold = interaction.options.getInteger("threshold") || 3;
      setStarboardConfig(interaction.guildId, channel.id, threshold);
      return interaction.reply({ content: `⭐ Starboard set to ${channel} (threshold: ${threshold} stars).`, ephemeral: false });
    }
    if (sub === "off") {
      removeStarboardConfig(interaction.guildId);
      return interaction.reply({ content: "Starboard disabled.", ephemeral: false });
    }
    return;
  }

  // --- /welcome ---
  if (interaction.commandName === "welcome") {
    if (!interaction.memberPermissions?.has("ManageGuild")) {
      return interaction.reply({ content: "You need **Manage Server** permission.", ephemeral: true });
    }
    const sub = interaction.options.getSubcommand();
    if (sub === "set") {
      const channel = interaction.options.getChannel("channel");
      const msg = interaction.options.getString("message");
      setWelcomeMessage(interaction.guildId, channel.id, msg);
      return interaction.reply({ content: `✅ Welcome messages will be sent to ${channel}.\nTemplate: ${msg}`, ephemeral: false });
    }
    if (sub === "off") {
      disableWelcome(interaction.guildId);
      return interaction.reply({ content: "Welcome messages disabled.", ephemeral: false });
    }
    return;
  }

  // --- /leave ---
  if (interaction.commandName === "leave") {
    if (!interaction.memberPermissions?.has("ManageGuild")) {
      return interaction.reply({ content: "You need **Manage Server** permission.", ephemeral: true });
    }
    const sub = interaction.options.getSubcommand();
    if (sub === "set") {
      const channel = interaction.options.getChannel("channel");
      const msg = interaction.options.getString("message");
      setLeaveMessage(interaction.guildId, channel.id, msg);
      return interaction.reply({ content: `✅ Leave messages will be sent to ${channel}.\nTemplate: ${msg}`, ephemeral: false });
    }
    if (sub === "off") {
      disableLeave(interaction.guildId);
      return interaction.reply({ content: "Leave messages disabled.", ephemeral: false });
    }
    return;
  }

  // --- /ticket-setup ---
  if (interaction.commandName === "ticket-setup") {
    if (!interaction.memberPermissions?.has("ManageGuild")) {
      return interaction.reply({ content: "You need **Manage Server** permission.", ephemeral: true });
    }
    const category = interaction.options.getChannel("category");
    const supportRole = interaction.options.getRole("support_role");
    const logChannel = interaction.options.getChannel("log_channel");
    setTicketConfig(interaction.guildId, category.id, supportRole?.id, logChannel?.id);
    return interaction.reply({
      content: `🎫 Ticket system configured!\n**Category:** ${category.name}\n**Support role:** ${supportRole?.name || "None"}\n**Log channel:** ${logChannel ? `#${logChannel.name}` : "None"}\n\nUsers can type \`!ticket [reason]\` to open a ticket.`,
      ephemeral: false,
    });
  }

  // --- /confess-setup ---
  if (interaction.commandName === "confess-setup") {
    if (!interaction.memberPermissions?.has("ManageGuild")) {
      return interaction.reply({ content: "You need **Manage Server** permission.", ephemeral: true });
    }
    const channel = interaction.options.getChannel("channel");
    setConfessionChannel(interaction.guildId, channel.id);
    return interaction.reply({ content: `🤫 Confessions will be posted to ${channel}. Members can use \`/confess\`.`, ephemeral: false });
  }

  // --- /confess-off ---
  if (interaction.commandName === "confess-off") {
    if (!interaction.memberPermissions?.has("ManageGuild")) {
      return interaction.reply({ content: "You need **Manage Server** permission.", ephemeral: true });
    }
    disableConfessions(interaction.guildId);
    return interaction.reply({ content: "Confessions disabled.", ephemeral: false });
  }

  // --- /confess ---
  if (interaction.commandName === "confess") {
    const guildId = interaction.guildId;
    if (!guildId) return interaction.reply({ content: "Use this in a server.", ephemeral: true });
    const text = interaction.options.getString("message");
    if (!text || text.trim().length === 0) {
      return interaction.reply({ content: "Your confession can't be empty.", ephemeral: true });
    }
    if (text.length > 2000) {
      return interaction.reply({ content: "Confession is too long (max 2000 characters).", ephemeral: true });
    }
    const result = await postConfession(interaction.client, guildId, text);
    if (!result.ok) {
      return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    }
    return interaction.reply({ content: "✅ Your confession has been posted anonymously.", ephemeral: true });
  }

  // --- /modlog-setup ---
  if (interaction.commandName === "modlog-setup") {
    if (!interaction.memberPermissions?.has("ManageGuild")) {
      return interaction.reply({ content: "You need **Manage Server** permission.", ephemeral: true });
    }
    const channel = interaction.options.getChannel("channel");
    setModLogChannel(interaction.guildId, channel.id);
    return interaction.reply({ content: `📋 Mod logs will be sent to ${channel}.`, ephemeral: false });
  }

  // --- /modlog-off ---
  if (interaction.commandName === "modlog-off") {
    if (!interaction.memberPermissions?.has("ManageGuild")) {
      return interaction.reply({ content: "You need **Manage Server** permission.", ephemeral: true });
    }
    disableModLog(interaction.guildId);
    return interaction.reply({ content: "Mod logging disabled.", ephemeral: false });
  }

  if (interaction.commandName !== "send") return;

  const channel = interaction.options.getChannel("channel");
  const opts = getMessageOptionsFromInteraction(interaction);
  if (!hasMessageContent(opts)) {
    return interaction.reply({
      content: "Provide at least **content** or **embed_title** / **embed_description** (or author, footer, image, etc.).",
      ephemeral: true,
    });
  }
  const payload = buildMessagePayload(opts);

  try {
    await channel.send(payload);
    await interaction.reply({
      content: `Message sent to ${channel}.`,
      ephemeral: true,
    });
  } catch (err) {
    console.error(err);
    await interaction.reply({
      content: `Failed to send: ${err.message}`,
      ephemeral: true,
    });
  }
}
