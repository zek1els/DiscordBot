import { Client, GatewayIntentBits, REST, Routes } from "discord.js";
import { config } from "dotenv";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { createApi } from "./api.js";
import { initScheduler, addSchedule, listSchedules, removeSchedule } from "./scheduler.js";
import { buildMessagePayload, hasMessageContent } from "./embedBuilder.js";
import { save as saveMessage, get as getSavedMessage, list as listSavedMessages, remove as removeSavedMessage } from "./savedMessages.js";
import { getLogChannelIdsForGuild, addLogChannel, removeLogChannel, getAllLogChannels } from "./deletedLogConfig.js";
import { list as listCustomCommands, get as getCustomCommand, getPrefix as getCustomCommandPrefix, migrateIfNeeded as migrateCustomCommands, totalCount as totalCustomCommands } from "./customCommands.js";
import { getConfig as getJailConfig, setConfig as setJailConfig, saveJailedRoles, popJailedRoles } from "./jailConfig.js";
import { handleEconomyCommand, ECONOMY_COMMAND_NAMES } from "./economyCommands.js";
import { getDataDir } from "./dataDir.js";

config();

/** Ensure data directory and default config files exist so custom commands and deleted-log config persist. */
function ensureDataStorage() {
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const customCommandsPath = join(dir, "custom-commands.json");
  const deletedLogPath = join(dir, "deleted-log-config.json");
  const jailConfigPath = join(dir, "jail-config.json");
  if (!existsSync(customCommandsPath)) writeFileSync(customCommandsPath, "{}", "utf8");
  migrateCustomCommands();
  if (!existsSync(deletedLogPath)) writeFileSync(deletedLogPath, JSON.stringify({ channels: [] }, null, 2), "utf8");
  if (!existsSync(jailConfigPath)) writeFileSync(jailConfigPath, "{}", "utf8");
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers, // Required for auto-role on join and !jail
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent, // Required for !custom commands and deleted-message logging
  ],
});

// Shared message options for rich embeds (embed-generator style)
const embedOptions = [
  { name: "content", type: 3, description: "Main message text", required: false },
  { name: "embed_title", type: 3, description: "Embed title", required: false },
  { name: "embed_description", type: 3, description: "Embed description", required: false },
  { name: "embed_color", type: 3, description: "Embed color (hex, e.g. #FF5733)", required: false },
  { name: "embed_url", type: 3, description: "Clickable embed title URL", required: false },
  { name: "author_name", type: 3, description: "Embed author name", required: false },
  { name: "author_icon_url", type: 3, description: "Author icon image URL", required: false },
  { name: "footer_text", type: 3, description: "Embed footer text", required: false },
  { name: "footer_icon_url", type: 3, description: "Footer icon image URL", required: false },
  { name: "thumbnail_url", type: 3, description: "Thumbnail image URL", required: false },
  { name: "image_url", type: 3, description: "Large image URL", required: false },
  { name: "timestamp", type: 5, description: "Show current time in embed", required: false },
  { name: "field1_name", type: 3, description: "Field 1 name", required: false },
  { name: "field1_value", type: 3, description: "Field 1 value", required: false },
  { name: "field2_name", type: 3, description: "Field 2 name", required: false },
  { name: "field2_value", type: 3, description: "Field 2 value", required: false },
  { name: "field3_name", type: 3, description: "Field 3 name", required: false },
  { name: "field3_value", type: 3, description: "Field 3 value", required: false },
];

function getMessageOptionsFromInteraction(interaction) {
  const o = interaction.options;
  return {
    content: o.getString("content"),
    embed_title: o.getString("embed_title"),
    embed_description: o.getString("embed_description"),
    embed_color: o.getString("embed_color"),
    embed_url: o.getString("embed_url"),
    author_name: o.getString("author_name"),
    author_icon_url: o.getString("author_icon_url"),
    footer_text: o.getString("footer_text"),
    footer_icon_url: o.getString("footer_icon_url"),
    thumbnail_url: o.getString("thumbnail_url"),
    image_url: o.getString("image_url"),
    timestamp: o.getBoolean("timestamp"),
    field1_name: o.getString("field1_name"),
    field1_value: o.getString("field1_value"),
    field2_name: o.getString("field2_name"),
    field2_value: o.getString("field2_value"),
    field3_name: o.getString("field3_name"),
    field3_value: o.getString("field3_value"),
  };
}

const sendCommand = {
  name: "send",
  description: "Send a rich embed message to a channel (message.style style)",
  options: [
    { name: "channel", type: 7, description: "Channel to send to", required: true },
    ...embedOptions,
  ],
};

const scheduleCommand = {
  name: "schedule",
  description: "Schedule recurring messages to a channel",
  options: [
    {
      name: "create",
      type: 1,
      description: "Create a new scheduled message",
      options: [
        { name: "channel", type: 7, description: "Channel to send to", required: true },
        {
          name: "schedule_type",
          type: 3,
          description: "How often to send",
          required: true,
          choices: [
            { name: "Every N minutes", value: "interval_minutes" },
            { name: "Daily at a time", value: "daily" },
            { name: "Weekly (e.g. every 7 days)", value: "weekly" },
          ],
        },
        { name: "saved_message", type: 3, description: "Use a saved message template (or set content/embed below)", required: false },
        { name: "content", type: 3, description: "Message text (if not using saved message)", required: false },
        { name: "embed_title", type: 3, description: "Embed title", required: false },
        { name: "embed_description", type: 3, description: "Embed description", required: false },
        { name: "embed_color", type: 3, description: "Embed color (hex)", required: false },
        { name: "minutes", type: 4, description: "For 'Every N minutes': interval (1–60)", required: false },
        { name: "time", type: 3, description: "For daily/weekly: time as HH:MM (24h)", required: false },
        { name: "day_of_week", type: 4, description: "For weekly: 0=Sun, 1=Mon … 7=Sun", required: false },
        { name: "timezone", type: 3, description: "e.g. America/New_York (default: UTC)", required: false },
      ],
    },
    { name: "list", type: 1, description: "List all scheduled messages" },
    { name: "delete", type: 1, description: "Remove a scheduled message", options: [{ name: "id", type: 3, description: "Schedule ID (from /schedule list)", required: true }] },
  ],
};

const logDeletesCommand = {
  name: "log-deletes",
  description: "Send deleted message logs to this channel (or turn off)",
  options: [
    { name: "here", type: 1, description: "Send deleted message logs to this channel" },
    { name: "off", type: 1, description: "Stop sending logs to this channel" },
  ],
};

const messageCommand = {
  name: "message",
  description: "Save and reuse message templates (rich embeds)",
  options: [
    {
      name: "save",
      type: 1,
      description: "Save a message template by name",
      options: [
        { name: "name", type: 3, description: "Template name (e.g. welcome)", required: true },
        ...embedOptions,
      ],
    },
    {
      name: "send",
      type: 1,
      description: "Send a saved message template to a channel",
      options: [
        { name: "channel", type: 7, description: "Channel to send to", required: true },
        { name: "name", type: 3, description: "Saved template name", required: true },
      ],
    },
    { name: "list", type: 1, description: "List saved message templates" },
    { name: "delete", type: 1, description: "Delete a saved template", options: [{ name: "name", type: 3, description: "Template name", required: true }] },
  ],
};

const jailSetupCommand = {
  name: "jail-setup",
  description: "Configure the jail system: set the member role and criminal role",
  options: [
    { name: "member_role", type: 8, description: "Role that grants server access (given to everyone)", required: true },
    { name: "criminal_role", type: 8, description: "Role assigned when jailed (member role removed)", required: true },
    { name: "allowed_role_1", type: 8, description: "Role allowed to use !jail/!unjail (optional)", required: false },
    { name: "allowed_role_2", type: 8, description: "Second allowed role (optional)", required: false },
    { name: "allowed_role_3", type: 8, description: "Third allowed role (optional)", required: false },
  ],
};

const jailAssignAllCommand = {
  name: "jail-assign-all",
  description: "Give the member role to every current member who doesn't have it",
};

const slashCommands = [sendCommand, scheduleCommand, messageCommand, logDeletesCommand, jailSetupCommand, jailAssignAllCommand];

client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  try {
    const guilds = client.guilds.cache;
    if (guilds.size > 0) {
      for (const [guildId] of guilds) {
        await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: slashCommands });
      }
      console.log(`Slash commands registered in ${guilds.size} guild(s) (including /log-deletes).`);
    } else {
      await rest.put(Routes.applicationCommands(client.user.id), { body: slashCommands });
      console.warn("No guilds in cache. Registered global commands (may take up to 1 hour to appear).");
    }
  } catch (e) {
    console.error("Failed to register slash commands:", e);
  }
  ensureDataStorage();
  const dataDir = getDataDir();
  const customCount = totalCustomCommands();
  const logChannelCount = getAllLogChannels().length;
  console.log(`Data directory: ${dataDir} (deleted-log channels: ${logChannelCount}, custom commands: ${customCount}). On Railway, set DATA_DIR to a volume path (e.g. /data) so this data persists across restarts.`);
  initScheduler(client);

  const port = Number(process.env.PORT) || 3000;
  const api = createApi(client);
  api.listen(port, "0.0.0.0", () => {
    console.log(`Web app: http://localhost:${port}`);
  });
});

client.on("guildCreate", async (guild) => {
  try {
    const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: slashCommands });
    console.log(`Slash commands registered in new guild: ${guild.name} (${guild.id}).`);
  } catch (e) {
    console.error("Failed to register slash commands for new guild:", e);
  }
});

client.on("guildMemberAdd", async (member) => {
  const cfg = getJailConfig(member.guild.id);
  if (!cfg?.memberRoleId) return;
  try {
    await member.roles.add(cfg.memberRoleId);
  } catch (e) {
    console.error(`Failed to assign member role to ${member.user?.tag} in ${member.guild.name}:`, e.message || e);
  }
});

// Accept both ASCII "!" and fullwidth "！" (U+FF01) as custom-command prefix
const CUSTOM_CMD_PREFIXES = ["!", "\uFF01"];

client.on("messageCreate", async (message) => {
  if (message.author?.bot) return;
  const raw = message.content;
  if (raw == null || typeof raw !== "string") return;
  const content = raw.trim();
  if (!content) return;
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
      { name: "📖 General", value: "`!help` / `!h` — Show this menu", inline: false },
      { name: "💰 Economy", value: "`!bal` — Balance · `!d` — Daily · `!w` — Work · `!j` — Jobs · `!ap` — Apply\n`!q` — Quest · `!cf` — Coinflip · `!sl` — Slots · `!bj` — Blackjack\n`!r` — Rob · `!give` — Send coins · `!lb` — Leaderboard\n`!dep`/`!with` — Bank · `!s` — Shop · `!b` — Buy · `!inv` — Inventory · `!st` — Stats\nType `!eco` for detailed help", inline: false },
      { name: "⚖️ Jail", value: "`!jail @user` — Remove roles & assign criminal role\n`!unjail @user` — Restore roles & release", inline: false },
    ];
    const customCmds = listCustomCommands(message.guild?.id);
    if (customCmds.length > 0) {
      const cmdList = customCmds.map((c) => `\`!${c.name}\``).join("  ");
      fields.push({ name: "⚡ Custom Commands", value: cmdList, inline: false });
    }
    await message.channel.send({ embeds: [{
      color: 0x5865f2,
      title: "📖  All Commands",
      fields,
      footer: { text: "Most commands have short aliases · Use !eco for economy details" },
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
      } else {
        if (cfg.criminalRoleId) await member.roles.remove(cfg.criminalRoleId);
        const savedRoles = popJailedRoles(message.guild.id, target.id);
        if (savedRoles && savedRoles.length > 0) {
          await member.roles.add(savedRoles);
        } else if (cfg.memberRoleId) {
          await member.roles.add(cfg.memberRoleId);
        }
        await message.channel.send({ content: `<@${target.id}> has been released from jail.` });
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
});

client.on("messageDelete", async (message) => {
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
    } catch (_) {
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
});

client.on("interactionCreate", async (interaction) => {
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
        } catch (_) {}
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
        content: "Deleted message logs will be sent to this channel. The bot monitors every server it’s in; logs for this server will appear here.",
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
});

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error("Missing DISCORD_TOKEN in .env");
  process.exit(1);
}

process.on("SIGTERM", () => {
  client.destroy();
  process.exit(0);
});

client.login(token);
