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

export const slashCommands = [
  sendCommand, scheduleCommand, messageCommand, logDeletesCommand,
  jailSetupCommand, jailAssignAllCommand,
  levelCommand, leaderboardCommand,
  warnCommand, warningsCommand, clearWarningsCommand,
];
