import { Client, GatewayIntentBits, Partials, REST, Routes } from "discord.js";
import { config } from "dotenv";
import { createApi } from "./api.js";
import { initScheduler } from "./scheduler.js";
import { getAllLogChannels } from "./deletedLogConfig.js";
import { migrateIfNeeded as migrateCustomCommands, totalCount as totalCustomCommands } from "./customCommands.js";
import { getConfig as getJailConfig } from "./jailConfig.js";
import { getDataDir } from "./dataDir.js";
import { slashCommands } from "./commands.js";
import { handleMessage, setClient as setMessageClient } from "./handlers/messageHandler.js";
import { handleInteraction } from "./handlers/interactionHandler.js";
import { handleMessageDelete, handleMessageUpdate } from "./handlers/deleteLogHandler.js";
import { handleVoiceStateUpdate } from "./handlers/voiceStateHandler.js";
import { initMusic } from "./music.js";
import { initReminders } from "./reminders.js";
import { initGiveaways } from "./giveaways.js";
import { handleMemberJoin, handleMemberLeave } from "./welcomeConfig.js";
import { handleStarboardReaction } from "./starboard.js";
import { recordDeleted, recordEdited } from "./snipe.js";
import { sendModLog } from "./modLog.js";

config();

const WEB_ONLY = (process.env.WEB_ONLY || "").toLowerCase() === "true";

function ensureDataStorage() {
  migrateCustomCommands();
}

if (WEB_ONLY) {
  // Railway: only start the Express web panel, no Discord bot
  ensureDataStorage();
  const { createApi } = await import("./api.js");
  const port = Number(process.env.PORT) || 3000;
  const api = createApi(null);
  api.listen(port, "0.0.0.0", () => {
    console.log(`Web panel (web-only mode): http://localhost:${port}`);
  });
} else {

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildModeration,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  // Pass client reference to message handler for utility commands
  setMessageClient(client);

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  try {
    const guilds = client.guilds.cache;
    if (guilds.size > 0) {
      for (const [guildId] of guilds) {
        await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: slashCommands });
      }
      console.log(`Slash commands registered in ${guilds.size} guild(s).`);
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
  console.log(`Data directory: ${dataDir} (deleted-log channels: ${logChannelCount}, custom commands: ${customCount}).`);

  // Initialise subsystems
  initScheduler(client);
  initReminders(client);
  initGiveaways(client);
  await initMusic().catch((e) => console.warn("Music init:", e.message));

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
  // Auto-assign member role (jail system)
  const cfg = getJailConfig(member.guild.id);
  if (cfg?.memberRoleId) {
    try {
      await member.roles.add(cfg.memberRoleId);
    } catch (e) {
      console.error(`Failed to assign member role to ${member.user?.tag} in ${member.guild.name}:`, e.message || e);
    }
  }
  // Welcome message
  handleMemberJoin(member);
  // Mod log
  sendModLog(client, member.guild.id, "join", { userId: member.id, extra: `Account created: <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>` });
});

client.on("guildMemberRemove", (member) => {
  handleMemberLeave(member);
  sendModLog(client, member.guild.id, "leave", { userId: member.id });
});

client.on("guildBanAdd", (ban) => {
  sendModLog(client, ban.guild.id, "ban", { userId: ban.user.id, reason: ban.reason || "No reason provided" });
});

client.on("guildBanRemove", (ban) => {
  sendModLog(client, ban.guild.id, "unban", { userId: ban.user.id });
});

client.on("guildMemberUpdate", (oldMember, newMember) => {
  // Nickname change
  if (oldMember.nickname !== newMember.nickname) {
    sendModLog(client, newMember.guild.id, "nick_change", {
      userId: newMember.id,
      oldNick: oldMember.nickname || oldMember.user.username,
      newNick: newMember.nickname || newMember.user.username,
    });
  }
  // Role changes
  const addedRoles = newMember.roles.cache.filter((r) => !oldMember.roles.cache.has(r.id));
  const removedRoles = oldMember.roles.cache.filter((r) => !newMember.roles.cache.has(r.id));
  for (const [, role] of addedRoles) {
    if (role.id === newMember.guild.id) continue;
    sendModLog(client, newMember.guild.id, "role_add", { userId: newMember.id, role: role.name });
  }
  for (const [, role] of removedRoles) {
    if (role.id === newMember.guild.id) continue;
    sendModLog(client, newMember.guild.id, "role_remove", { userId: newMember.id, role: role.name });
  }
});

client.on("messageCreate", (message) => handleMessage(message));

client.on("messageDelete", (message) => {
  recordDeleted(message); // snipe
  handleMessageDelete(message, client); // deleted log
  // Mod log
  if (message.guildId && message.author && !message.author.bot) {
    sendModLog(client, message.guildId, "message_delete", {
      userId: message.author.id,
      channel: `<#${message.channelId}>`,
      content: message.content || "*(embed/attachment)*",
    });
  }
});

client.on("messageUpdate", (oldMessage, newMessage) => {
  recordEdited(oldMessage, newMessage); // edit snipe
  handleMessageUpdate(oldMessage, newMessage, client); // edit log
  // Mod log
  if (newMessage.guildId && newMessage.author && !newMessage.author.bot && oldMessage.content !== newMessage.content) {
    sendModLog(client, newMessage.guildId, "message_edit", {
      userId: newMessage.author.id,
      channel: `<#${newMessage.channelId}>`,
      oldContent: oldMessage.content || "*(empty)*",
      newContent: newMessage.content || "*(empty)*",
    });
  }
});

client.on("voiceStateUpdate", (oldState, newState) => {
  handleVoiceStateUpdate(oldState, newState);
  // Mod log voice events
  const guildId = newState.guild.id;
  const userId = newState.member?.id;
  if (!userId) return;
  if (!oldState.channelId && newState.channelId) {
    sendModLog(client, guildId, "voice_join", { userId, channel: `<#${newState.channelId}>` });
  } else if (oldState.channelId && !newState.channelId) {
    sendModLog(client, guildId, "voice_leave", { userId, channel: `<#${oldState.channelId}>` });
  } else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
    sendModLog(client, guildId, "voice_move", { userId, extra: `<#${oldState.channelId}> → <#${newState.channelId}>` });
  }
});
client.on("interactionCreate", (interaction) => handleInteraction(interaction));

// Starboard — react to star reactions
client.on("messageReactionAdd", (reaction) => {
  handleStarboardReaction(reaction, client);
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

} // end of else (bot mode)
