export const embedOptions = [
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

export function getMessageOptionsFromInteraction(interaction) {
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

export const sendCommand = {
  name: "send",
  description: "Send a rich embed message to a channel (message.style style)",
  options: [
    { name: "channel", type: 7, description: "Channel to send to", required: true },
    ...embedOptions,
  ],
};

export const scheduleCommand = {
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

export const messageCommand = {
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

export const logDeletesCommand = {
  name: "log-deletes",
  description: "Send deleted message logs to this channel (or turn off)",
  options: [
    { name: "here", type: 1, description: "Send deleted message logs to this channel" },
    { name: "off", type: 1, description: "Stop sending logs to this channel" },
  ],
};

export const jailSetupCommand = {
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

export const jailAssignAllCommand = {
  name: "jail-assign-all",
  description: "Give the member role to every current member who doesn't have it",
};

export const levelCommand = {
  name: "level",
  description: "Check your level and XP (or another user's)",
  options: [
    { name: "user", type: 6, description: "User to check (defaults to yourself)", required: false },
  ],
};

export const leaderboardCommand = {
  name: "leaderboard",
  description: "View server leaderboards",
  options: [
    {
      name: "type",
      type: 3,
      description: "Which leaderboard to show",
      required: false,
      choices: [
        { name: "XP (default)", value: "xp" },
        { name: "Messages", value: "messages" },
        { name: "Voice chat time", value: "vc" },
      ],
    },
  ],
};

export const warnCommand = {
  name: "warn",
  description: "Warn a user",
  options: [
    { name: "user", type: 6, description: "User to warn", required: true },
    { name: "reason", type: 3, description: "Reason for warning", required: true },
  ],
};

export const warningsCommand = {
  name: "warnings",
  description: "View warnings for a user",
  options: [
    { name: "user", type: 6, description: "User to check", required: true },
  ],
};

export const clearWarningsCommand = {
  name: "clearwarnings",
  description: "Clear all warnings for a user",
  options: [
    { name: "user", type: 6, description: "User to clear warnings for", required: true },
  ],
};

export const purgeCommand = {
  name: "purge",
  description: "Bulk delete messages from this channel",
  options: [
    { name: "amount", type: 4, description: "Number of messages to delete (1–100)", required: true, min_value: 1, max_value: 100 },
    { name: "user", type: 6, description: "Only delete messages from this user", required: false },
  ],
};

export const starboardCommand = {
  name: "starboard",
  description: "Configure the starboard",
  options: [
    {
      name: "setup",
      type: 1,
      description: "Set the starboard channel and star threshold",
      options: [
        { name: "channel", type: 7, description: "Channel for starboard posts", required: true },
        { name: "threshold", type: 4, description: "Stars needed (default: 3)", required: false, min_value: 1, max_value: 25 },
      ],
    },
    { name: "off", type: 1, description: "Disable starboard" },
  ],
};

export const welcomeCommand = {
  name: "welcome",
  description: "Configure welcome messages",
  options: [
    {
      name: "set",
      type: 1,
      description: "Set a welcome message for new members",
      options: [
        { name: "channel", type: 7, description: "Channel for welcome messages", required: true },
        { name: "message", type: 3, description: "Message ({user} {username} {server} {memberCount})", required: true },
      ],
    },
    { name: "off", type: 1, description: "Disable welcome messages" },
  ],
};

export const leaveCommand = {
  name: "leave",
  description: "Configure leave messages",
  options: [
    {
      name: "set",
      type: 1,
      description: "Set a leave message when members leave",
      options: [
        { name: "channel", type: 7, description: "Channel for leave messages", required: true },
        { name: "message", type: 3, description: "Message ({username} {server} {memberCount})", required: true },
      ],
    },
    { name: "off", type: 1, description: "Disable leave messages" },
  ],
};

export const ticketSetupCommand = {
  name: "ticket-setup",
  description: "Configure the ticket system",
  options: [
    { name: "category", type: 7, description: "Category for ticket channels", required: true },
    { name: "support_role", type: 8, description: "Role that can see tickets", required: false },
    { name: "log_channel", type: 7, description: "Channel for ticket transcripts", required: false },
  ],
};

export const confessSetupCommand = {
  name: "confess-setup",
  description: "Set the channel for anonymous confessions",
  options: [
    { name: "channel", type: 7, description: "Channel for confessions", required: true },
  ],
};

export const confessOffCommand = {
  name: "confess-off",
  description: "Disable the confession system",
};

export const confessCommand = {
  name: "confess",
  description: "Submit an anonymous confession",
  options: [
    { name: "message", type: 3, description: "Your anonymous confession", required: true },
  ],
};

export const modlogSetupCommand = {
  name: "modlog-setup",
  description: "Set the channel for mod action logs",
  options: [
    { name: "channel", type: 7, description: "Channel for mod logs", required: true },
  ],
};

export const modlogOffCommand = {
  name: "modlog-off",
  description: "Disable mod logging",
};

export const reactionRoleCommand = {
  name: "reactionrole",
  description: "Manage reaction roles",
  options: [
    {
      name: "add", type: 1, description: "Add a reaction role to a message",
      options: [
        { name: "channel", type: 7, description: "Channel the message is in", required: true },
        { name: "message_id", type: 3, description: "Message ID", required: true },
        { name: "emoji", type: 3, description: "Emoji (e.g. or custom emoji name)", required: true },
        { name: "role", type: 8, description: "Role to assign", required: true },
      ],
    },
    {
      name: "remove", type: 1, description: "Remove a reaction role",
      options: [
        { name: "message_id", type: 3, description: "Message ID", required: true },
        { name: "emoji", type: 3, description: "Emoji to remove", required: true },
      ],
    },
    { name: "list", type: 1, description: "List all reaction roles" },
  ],
};

export const automodCommand = {
  name: "automod",
  description: "Configure auto-moderation",
  options: [
    { name: "enable", type: 1, description: "Enable auto-mod" },
    { name: "disable", type: 1, description: "Disable auto-mod" },
    {
      name: "spam", type: 1, description: "Configure spam filter",
      options: [
        { name: "max_messages", type: 4, description: "Max messages in interval (default: 5)", required: false },
        { name: "interval", type: 4, description: "Interval in seconds (default: 5)", required: false },
        { name: "action", type: 3, description: "Action to take", required: false, choices: [
          { name: "Mute (5 min)", value: "mute" }, { name: "Kick", value: "kick" },
          { name: "Delete only", value: "delete" }, { name: "Warn (log only)", value: "warn" },
        ]},
      ],
    },
    {
      name: "links", type: 1, description: "Configure link filter",
      options: [
        { name: "enabled", type: 5, description: "Enable or disable", required: true },
        { name: "action", type: 3, description: "Action to take", required: false, choices: [
          { name: "Delete", value: "delete" }, { name: "Mute", value: "mute" }, { name: "Warn", value: "warn" },
        ]},
      ],
    },
    {
      name: "words", type: 1, description: "Manage word blacklist",
      options: [
        { name: "action", type: 3, description: "Add or remove a word", required: true, choices: [
          { name: "Add", value: "add" }, { name: "Remove", value: "remove" }, { name: "List", value: "list" },
        ]},
        { name: "word", type: 3, description: "The word to add/remove", required: false },
      ],
    },
    {
      name: "log", type: 1, description: "Set auto-mod log channel",
      options: [
        { name: "channel", type: 7, description: "Channel for auto-mod logs", required: true },
      ],
    },
  ],
};

export const tempvoiceCommand = {
  name: "tempvoice",
  description: "Temporary voice channels",
  options: [
    {
      name: "setup", type: 1, description: "Set up Join-to-Create voice channels",
      options: [
        { name: "channel", type: 7, description: "The 'Join to Create' voice channel", required: true },
        { name: "category", type: 7, description: "Category for temp channels", required: true },
        { name: "name_template", type: 3, description: "Channel name template ({user} = username)", required: false },
      ],
    },
    { name: "disable", type: 1, description: "Disable temp voice channels" },
    {
      name: "name", type: 1, description: "Rename your temp channel",
      options: [{ name: "new_name", type: 3, description: "New channel name", required: true }],
    },
    {
      name: "limit", type: 1, description: "Set user limit for your temp channel",
      options: [{ name: "number", type: 4, description: "Max users (0 = unlimited)", required: true, min_value: 0, max_value: 99 }],
    },
    { name: "lock", type: 1, description: "Lock your temp channel" },
    { name: "unlock", type: 1, description: "Unlock your temp channel" },
  ],
};

export const levelsConfigCommand = {
  name: "levels",
  description: "Configure the leveling system",
  default_member_permissions: "32", // MANAGE_SERVER
  options: [
    {
      name: "role-reward", type: 2, description: "Manage level role rewards",
      options: [
        {
          name: "add", type: 1, description: "Add a role reward at a specific level",
          options: [
            { name: "level", type: 4, description: "Level to grant the role at", required: true, min_value: 1 },
            { name: "role", type: 8, description: "Role to grant", required: true },
          ],
        },
        {
          name: "remove", type: 1, description: "Remove a role reward",
          options: [
            { name: "level", type: 4, description: "Level to remove the reward from", required: true },
          ],
        },
        { name: "list", type: 1, description: "List all role rewards" },
      ],
    },
    {
      name: "announce", type: 1, description: "Set level-up announcement channel",
      options: [
        { name: "channel", type: 7, description: "Channel for level-up messages (leave empty to use same channel)", required: false },
      ],
    },
  ],
};

export const cacheMessagesCommand = {
  name: "cache-messages",
  description: "Cache all server message history into analytics (admin only, may take a while)",
  default_member_permissions: "8", // ADMINISTRATOR
  options: [
    {
      name: "reset",
      type: 5, // Boolean
      description: "Reset and re-cache everything (default: skip already-cached channels)",
      required: false,
    },
  ],
};

export const slashCommands = [
  sendCommand, scheduleCommand, messageCommand, logDeletesCommand,
  jailSetupCommand, jailAssignAllCommand,
  levelCommand, leaderboardCommand,
  warnCommand, warningsCommand, clearWarningsCommand,
  purgeCommand,
  starboardCommand, welcomeCommand, leaveCommand, ticketSetupCommand,
  confessSetupCommand, confessOffCommand, confessCommand,
  modlogSetupCommand, modlogOffCommand,
  reactionRoleCommand, automodCommand, tempvoiceCommand,
  levelsConfigCommand, cacheMessagesCommand,
];
