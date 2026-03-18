import { getMessageOptionsFromInteraction } from "../commands.js";
import { buildMessagePayload, hasMessageContent } from "../embedBuilder.js";
import { save as saveMessage, get as getSavedMessage, list as listSavedMessages, remove as removeSavedMessage } from "../savedMessages.js";
import { addLogChannel, removeLogChannel } from "../deletedLogConfig.js";
import { getConfig as getJailConfig, setConfig as setJailConfig } from "../jailConfig.js";
import { addSchedule, listSchedules, removeSchedule } from "../scheduler.js";

export async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return;

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
