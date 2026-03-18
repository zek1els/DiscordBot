import { Client, GatewayIntentBits, Partials, REST, Routes } from "discord.js";
import { config } from "dotenv";
import { createApi } from "./api.js";
import { initScheduler } from "./scheduler.js";
import { getAllLogChannels } from "./deletedLogConfig.js";
import { migrateIfNeeded as migrateCustomCommands, totalCount as totalCustomCommands } from "./customCommands.js";
import { getConfig as getJailConfig } from "./jailConfig.js";
import { getDataDir } from "./dataDir.js";
import { slashCommands } from "./commands.js";
import { handleMessage } from "./handlers/messageHandler.js";
import { handleInteraction } from "./handlers/interactionHandler.js";
import { handleMessageDelete, handleMessageUpdate } from "./handlers/deleteLogHandler.js";
import { handleVoiceStateUpdate } from "./handlers/voiceStateHandler.js";

config();

function ensureDataStorage() {
  migrateCustomCommands();
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Message, Partials.Channel],
});

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

client.on("messageCreate", (message) => handleMessage(message));
client.on("messageDelete", (message) => handleMessageDelete(message, client));
client.on("messageUpdate", (oldMessage, newMessage) => handleMessageUpdate(oldMessage, newMessage, client));
client.on("voiceStateUpdate", (oldState, newState) => handleVoiceStateUpdate(oldState, newState));
client.on("interactionCreate", (interaction) => handleInteraction(interaction));

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
