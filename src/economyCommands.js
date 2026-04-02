import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from "discord.js";
import {
  getUser, updateUser, addMoney, removeMoney,
  setCooldown, getCooldownRemaining,
  getLeaderboard, getJobLevel, claimDaily,
  JOBS, QUESTS, assignRandomQuest, checkQuestProgress, completeQuest,
  SHOP_ITEMS, buyItem, hasItem, consumeItem,
  formatCoins, formatCooldown,
} from "./economy.js";

// Track active blackjack games to prevent multiple simultaneous games
const activeBlackjack = new Map();

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const WORK_MESSAGES = {
  dishwasher: [
    "You washed dishes at a restaurant and earned {amount}!",
    "You scrubbed pots and pans for hours. Earned {amount}.",
  ],
  janitor: [
    "You mopped the floors all day. Earned {amount}.",
    "You cleaned the entire office building. Earned {amount}!",
  ],
  farmer: [
    "You harvested the crops and sold them. Earned {amount}!",
    "You tended the animals and sold some produce for {amount}.",
  ],
  fisher: [
    "You caught a big haul of fish! Earned {amount}.",
    "You spent the morning fishing and sold your catch for {amount}.",
  ],
  chef: [
    "You cooked a 5-course meal and earned {amount} in tips!",
    "Your souffl\u00e9 was perfect. Earned {amount}.",
  ],
  teacher: [
    "You taught a class of students and earned {amount}.",
    "You graded papers all night. Earned {amount}.",
  ],
  programmer: [
    "You shipped a feature and earned {amount}!",
    "You fixed a critical bug. Your boss paid you {amount}.",
    "You deployed to production on a Friday and somehow earned {amount}.",
  ],
  doctor: [
    "You performed a successful surgery. Earned {amount}!",
    "You treated patients all day and earned {amount}.",
  ],
  ceo: [
    "You made some executive decisions and earned {amount}.",
    "You fired someone and gave yourself a bonus of {amount}.",
    "You did absolutely nothing and still earned {amount}.",
  ],
};

const ROB_SUCCESS = [
  "You broke into their house and stole {amount}!",
  "You pickpocketed them and got away with {amount}.",
  "You distracted them and swiped {amount} from their wallet.",
];

const ROB_FAIL = [
  "You got caught and had to pay a {fine} fine!",
  "They called the cops on you. You paid {fine} in bail.",
  "You tripped while running away and lost {fine}.",
];

const SLOT_SYMBOLS = ["\ud83c\udf52", "\ud83c\udf4b", "\ud83c\udf4a", "\ud83c\udf47", "\ud83d\udc8e", "7\ufe0f\u20e3", "\ud83d\udd14"];

/**
 * Handle an economy command. Returns true if it was an economy command, false otherwise.
 * @param {import("discord.js").Message} message
 * @param {string} commandName - lowercase command name (after !)
 * @param {string} args - everything after the command name
 */
export async function handleEconomyCommand(message, commandName, args) {
  const guildId = message.guildId ?? message.guild?.id;
  if (!guildId) return false;
  const userId = message.author.id;

  const send = (content) => message.channel.send({ content }).catch(() => {});
  const sendEmbed = (embed) => message.channel.send({ embeds: [embed] }).catch(() => {});

  switch (commandName) {
    case "balance":
    case "bal": {
      const target = message.mentions?.users?.first() || message.author;
      const u = getUser(guildId, target.id);
      const name = target.id === userId ? "Your" : `${target.username}'s`;
      const total = u.wallet + u.bank;
      return sendEmbed({
        color: 0x57f287,
        title: `\ud83d\udcb0  ${name} Balance`,
        fields: [
          { name: "Wallet", value: formatCoins(u.wallet), inline: true },
          { name: "Bank", value: `${formatCoins(u.bank)} / ${formatCoins(u.bankLimit)}`, inline: true },
          { name: "Net Worth", value: formatCoins(total), inline: true },
        ],
        footer: { text: "Use !dep / !with to manage your bank" },
      }), true;
    }

    case "deposit":
    case "dep": {
      const u = getUser(guildId, userId);
      const amount = args.toLowerCase() === "all" ? u.wallet : parseInt(args);
      if (!amount || amount <= 0) return send("Usage: `!deposit <amount|all>`"), true;
      if (amount > u.wallet) return send(`You only have ${formatCoins(u.wallet)} in your wallet.`), true;
      const space = u.bankLimit - u.bank;
      if (space <= 0) return send("\ud83c\udfe6 Your bank is full! Buy a **Bank Upgrade** from the `!shop`."), true;
      const actual = Math.min(amount, space);
      updateUser(guildId, userId, (u) => { u.wallet -= actual; u.bank += actual; });
      return send(`\ud83c\udfe6 Deposited ${formatCoins(actual)} into your bank.`), true;
    }

    case "withdraw":
    case "with": {
      const u = getUser(guildId, userId);
      const amount = args.toLowerCase() === "all" ? u.bank : parseInt(args);
      if (!amount || amount <= 0) return send("Usage: `!withdraw <amount|all>`"), true;
      if (amount > u.bank) return send(`You only have ${formatCoins(u.bank)} in your bank.`), true;
      updateUser(guildId, userId, (u) => { u.wallet += amount; u.bank -= amount; });
      return send(`\ud83d\udcb5 Withdrew ${formatCoins(amount)} from your bank.`), true;
    }

    case "daily":
    case "d": {
      const result = claimDaily(guildId, userId);
      if (result.onCooldown) {
        return send(`\u23f0 You already claimed your daily! Come back in **${formatCooldown(result.remaining)}**.\n\ud83d\udd25 Current streak: **${result.streak}** day(s)`), true;
      }
      const info = result._dailyResult;
      const streakEmoji = info.streak >= 30 ? "\ud83d\udc51" : info.streak >= 14 ? "\ud83d\udd25" : info.streak >= 7 ? "\u2b50" : "\ud83c\udf1f";
      const bonusText = info.streakBonus > 0 ? `\nStreak bonus: +${formatCoins(info.streakBonus)}` : "";
      const multText = info.streakMultiplier > 1 ? ` (${info.streakMultiplier}x multiplier!)` : "";
      return sendEmbed({
        color: 0xfee75c,
        title: `${streakEmoji}  Daily Reward Claimed!`,
        description: `You received ${formatCoins(info.amount)}!${bonusText}${multText}`,
        fields: [
          { name: "\ud83d\udd25 Streak", value: `**${info.streak}** day(s)`, inline: true },
          { name: "Next Milestone", value: info.streak < 7 ? `7 days (1.25x)` : info.streak < 14 ? `14 days (1.5x)` : info.streak < 30 ? `30 days (2x)` : "Max streak!", inline: true },
        ],
        footer: { text: "Come back in 24h \u2022 Streak resets if you miss 48h" },
      }), true;
    }

    case "work":
    case "w": {
      const u = getUser(guildId, userId);
      if (!u.job) return send("\u274c You don't have a job! Use `!jobs` to see available jobs and `!apply <job>` to get one."), true;
      const job = JOBS.find((j) => j.id === u.job);
      if (!job) return send("\u274c Your job doesn't exist anymore. Use `!apply <job>` to get a new one."), true;
      const cd = getCooldownRemaining(guildId, userId, "work");
      if (cd > 0) return send(`\u23f0 You're tired! You can work again in **${formatCooldown(cd)}**.`), true;
      const amount = rand(job.pay[0], job.pay[1]);
      addMoney(guildId, userId, amount);
      setCooldown(guildId, userId, "work", job.cooldownMs);
      updateUser(guildId, userId, (u) => { u.stats.timesWorked++; });
      const msgs = WORK_MESSAGES[job.id] || [`You worked as a ${job.name} and earned {amount}.`];
      const msg = pick(msgs).replace("{amount}", formatCoins(amount));
      let text = `\ud83d\udcbc ${msg}`;
      const questInfo = checkQuestProgress(guildId, userId);
      if (questInfo && questInfo.done) {
        const completed = completeQuest(guildId, userId);
        if (completed) text += `\n\ud83c\udf89 **Quest complete!** "${completed.description}" \u2014 bonus ${formatCoins(completed.reward)}!`;
      }
      return send(text), true;
    }

    case "jobs":
    case "j": {
      const level = getJobLevel(guildId, userId);
      const u = getUser(guildId, userId);
      const fields = JOBS.map((j) => {
        const locked = j.requiredLevel > level;
        const current = u.job === j.id ? " \u2190 *your job*" : "";
        const lock = locked ? "\ud83d\udd12 " : "\u2705 ";
        const levelReq = locked ? ` *(requires level ${j.requiredLevel})*` : "";
        return {
          name: `${lock}${j.name}${current}`,
          value: `${j.pay[0]}\u2013${j.pay[1]} coins \u00b7 cooldown: ${formatCooldown(j.cooldownMs)}${levelReq}`,
          inline: false,
        };
      });
      return sendEmbed({
        color: 0x5865f2,
        title: "\ud83d\udcbc  Available Jobs",
        description: `Your current level: **${level}**\nLevel up by working (1 level per 5 works).`,
        fields,
        footer: { text: "Use !apply <job name> to take a job" },
      }), true;
    }

    case "apply":
    case "ap": {
      const jobName = args.toLowerCase().trim();
      if (!jobName) return send("Usage: `!apply <job name>` \u2014 use `!jobs` to see available jobs."), true;
      const job = JOBS.find((j) => j.id === jobName || j.name.toLowerCase() === jobName);
      if (!job) return send(`\u274c Job "${jobName}" not found. Use \`!jobs\` to see available jobs.`), true;
      const level = getJobLevel(guildId, userId);
      if (job.requiredLevel > level) return send(`\ud83d\udd12 You need level **${job.requiredLevel}** to apply as a **${job.name}**. You're level **${level}**.`), true;
      updateUser(guildId, userId, (u) => { u.job = job.id; });
      return send(`\u2705 You are now working as a **${job.name}**! Use \`!work\` to start earning.`), true;
    }

    case "quest":
    case "q": {
      const u = getUser(guildId, userId);
      if (!u.quest) {
        const cd = getCooldownRemaining(guildId, userId, "quest");
        if (cd > 0) return send(`\u23f0 You can get a new quest in **${formatCooldown(cd)}**.`), true;
        assignRandomQuest(guildId, userId);
        setCooldown(guildId, userId, "quest", 5 * 60 * 1000);
        const updated = getUser(guildId, userId);
        const q = QUESTS.find((q) => q.id === updated.quest?.id);
        return send(`\ud83d\udcdc **New Quest:** ${q?.description || "???"}\nReward: ${formatCoins(q?.reward || 0)}\nProgress: 0/${q?.target || "?"}\nProgress updates automatically as you play. Use \`!quest\` to check.`), true;
      }
      const info = checkQuestProgress(guildId, userId);
      if (!info) return send("Something went wrong with your quest. Use `!quest abandon` to get a new one."), true;
      if (info.done) {
        const completed = completeQuest(guildId, userId);
        if (completed) return send(`\ud83c\udf89 **Quest complete!** "${completed.description}" \u2014 you earned ${formatCoins(completed.reward)}!`), true;
      }
      return send(`\ud83d\udcdc **Current Quest:** ${info.quest.description}\nReward: ${formatCoins(info.quest.reward)}\nProgress: **${info.current}**/${info.target}`), true;
    }

    case "coinflip":
    case "cf": {
      const u = getUser(guildId, userId);
      const amount = args.toLowerCase() === "all" ? u.wallet : parseInt(args);
      if (!amount || amount <= 0) return send("Usage: `!coinflip <amount|all>`"), true;
      if (amount > u.wallet) return send(`You only have ${formatCoins(u.wallet)} in your wallet.`), true;
      const hasCharm = hasItem(guildId, userId, "lucky_charm");
      const winChance = hasCharm ? 0.55 : 0.5;
      if (hasCharm) consumeItem(guildId, userId, "lucky_charm");
      const won = Math.random() < winChance;
      if (won) {
        addMoney(guildId, userId, amount);
        updateUser(guildId, userId, (u) => { u.stats.gamblingWon++; });
        return send(`\ud83e\ude99 The coin lands on **heads**! You won ${formatCoins(amount)}!${hasCharm ? " \ud83c\udf40 Lucky charm used!" : ""}`), true;
      } else {
        removeMoney(guildId, userId, amount);
        updateUser(guildId, userId, (u) => { u.stats.gamblingLost++; });
        return send(`\ud83e\ude99 The coin lands on **tails**. You lost ${formatCoins(amount)}.${hasCharm ? " \ud83c\udf40 Lucky charm used but no luck!" : ""}`), true;
      }
    }

    case "slots":
    case "sl": {
      const u = getUser(guildId, userId);
      const amount = args.toLowerCase() === "all" ? u.wallet : parseInt(args);
      if (!amount || amount <= 0) return send("Usage: `!slots <amount|all>`"), true;
      if (amount > u.wallet) return send(`You only have ${formatCoins(u.wallet)} in your wallet.`), true;
      if (amount < 10) return send("Minimum bet is **10** coins."), true;
      removeMoney(guildId, userId, amount);
      const s1 = pick(SLOT_SYMBOLS), s2 = pick(SLOT_SYMBOLS), s3 = pick(SLOT_SYMBOLS);
      let multiplier = 0;
      if (s1 === s2 && s2 === s3) {
        multiplier = s1 === "7\ufe0f\u20e3" ? 10 : s1 === "\ud83d\udc8e" ? 7 : 5;
      } else if (s1 === s2 || s2 === s3 || s1 === s3) {
        multiplier = 2;
      }
      const display = `**[ ${s1} | ${s2} | ${s3} ]**`;
      if (multiplier > 0) {
        const winnings = amount * multiplier;
        addMoney(guildId, userId, winnings);
        updateUser(guildId, userId, (u) => { u.stats.gamblingWon++; });
        return send(`\ud83c\udfb0 ${display}\nYou won ${formatCoins(winnings)}! (${multiplier}x)`), true;
      } else {
        updateUser(guildId, userId, (u) => { u.stats.gamblingLost++; });
        return send(`\ud83c\udfb0 ${display}\nNo match. You lost ${formatCoins(amount)}.`), true;
      }
    }

    case "blackjack":
    case "bj": {
      const u = getUser(guildId, userId);
      const amount = args.toLowerCase() === "all" ? u.wallet : parseInt(args);
      if (!amount || amount <= 0) return send("Usage: `!blackjack <amount|all>`"), true;
      if (amount > u.wallet) return send(`You only have ${formatCoins(u.wallet)} in your wallet.`), true;
      if (activeBlackjack.has(userId)) return send("You already have a blackjack game in progress!"), true;
      removeMoney(guildId, userId, amount);

      const cards = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
      const suits = ["\u2660\ufe0f", "\u2665\ufe0f", "\u2666\ufe0f", "\u2663\ufe0f"];
      const drawCard = () => `${pick(cards)}${pick(suits)}`;
      const cardVal = (c) => { const v = c.replace(/[\u2660\ufe0f\u2665\ufe0f\u2666\ufe0f\u2663\ufe0f]/g, ""); return v === "A" ? 11 : ["J", "Q", "K"].includes(v) ? 10 : parseInt(v); };
      const handTotal = (hand) => {
        let total = hand.reduce((s, c) => s + cardVal(c), 0);
        let aces = hand.filter((c) => c.startsWith("A")).length;
        while (total > 21 && aces > 0) { total -= 10; aces--; }
        return total;
      };

      const playerHand = [drawCard(), drawCard()];
      const dealerHand = [drawCard(), drawCard()];

      const buildEmbed = (reveal = false) => {
        const pTotal = handTotal(playerHand);
        const dTotal = reveal ? handTotal(dealerHand) : cardVal(dealerHand[0]);
        return {
          color: 0x2b2d31,
          title: "\ud83c\udccf Blackjack",
          fields: [
            { name: `Your Hand (${pTotal})`, value: playerHand.join(" "), inline: true },
            { name: `Dealer ${reveal ? `(${dTotal})` : ""}`, value: reveal ? dealerHand.join(" ") : `${dealerHand[0]} \ud83c\udca0`, inline: true },
            { name: "Bet", value: formatCoins(amount), inline: true },
          ],
        };
      };

      // Check for natural blackjack
      if (handTotal(playerHand) === 21) {
        // Blackjack pays 2.5x
        const winnings = Math.floor(amount * 2.5);
        addMoney(guildId, userId, winnings);
        updateUser(guildId, userId, (u) => { u.stats.gamblingWon++; });
        const embed = buildEmbed(true);
        embed.color = 0x57f287;
        embed.footer = { text: `\ud83c\udf1f Blackjack! You won ${winnings.toLocaleString()} coins (2.5x)` };
        return message.channel.send({ embeds: [embed] }).catch(() => {}), true;
      }

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`bj_hit_${userId}`).setLabel("Hit").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`bj_stand_${userId}`).setLabel("Stand").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`bj_double_${userId}`).setLabel("Double Down").setStyle(ButtonStyle.Danger)
          .setDisabled(u.wallet < amount),
      );

      const msg = await message.channel.send({ embeds: [buildEmbed()], components: [buttons] }).catch(() => null);
      if (!msg) return true;

      activeBlackjack.set(userId, true);

      const collector = msg.createMessageComponentCollector({ time: 60_000 });
      let doubled = false;

      collector.on("collect", async (btn) => {
        if (btn.user.id !== userId) return btn.reply({ content: "This isn't your game!", flags: MessageFlags.Ephemeral });

        if (btn.customId === `bj_double_${userId}`) {
          removeMoney(guildId, userId, amount);
          doubled = true;
          playerHand.push(drawCard());
          // After double, auto-stand
          collector.stop("stand");
          return;
        }

        if (btn.customId === `bj_hit_${userId}`) {
          playerHand.push(drawCard());
          if (handTotal(playerHand) >= 21) {
            collector.stop("done");
            return;
          }
          // Disable double after first hit
          const newButtons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`bj_hit_${userId}`).setLabel("Hit").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`bj_stand_${userId}`).setLabel("Stand").setStyle(ButtonStyle.Secondary),
          );
          await btn.update({ embeds: [buildEmbed()], components: [newButtons] }).catch(() => {});
          return;
        }

        if (btn.customId === `bj_stand_${userId}`) {
          collector.stop("stand");
        }
      });

      collector.on("end", async (_, reason) => {
        activeBlackjack.delete(userId);
        const betAmount = doubled ? amount * 2 : amount;

        // Dealer plays
        while (handTotal(dealerHand) < 17) dealerHand.push(drawCard());

        const pTotal = handTotal(playerHand);
        const dTotal = handTotal(dealerHand);
        const embed = buildEmbed(true);

        if (reason === "time") {
          // Timeout — player loses
          embed.color = 0xed4245;
          embed.footer = { text: `\u23f0 Time's up! You lost ${betAmount.toLocaleString()} coins.` };
          updateUser(guildId, userId, (u) => { u.stats.gamblingLost++; });
        } else if (pTotal > 21) {
          embed.color = 0xed4245;
          embed.footer = { text: `Bust! You lost ${betAmount.toLocaleString()} coins.` };
          updateUser(guildId, userId, (u) => { u.stats.gamblingLost++; });
        } else if (dTotal > 21 || pTotal > dTotal) {
          const winnings = betAmount * 2;
          addMoney(guildId, userId, winnings);
          updateUser(guildId, userId, (u) => { u.stats.gamblingWon++; });
          embed.color = 0x57f287;
          embed.footer = { text: `You win ${betAmount.toLocaleString()} coins!` };
        } else if (pTotal === dTotal) {
          addMoney(guildId, userId, betAmount);
          embed.color = 0xfee75c;
          embed.footer = { text: "Push! Your bet was returned." };
        } else {
          embed.color = 0xed4245;
          embed.footer = { text: `Dealer wins. You lost ${betAmount.toLocaleString()} coins.` };
          updateUser(guildId, userId, (u) => { u.stats.gamblingLost++; });
        }

        await msg.edit({ embeds: [embed], components: [] }).catch(() => {});
      });

      return true;
    }

    case "rob":
    case "r": {
      const target = message.mentions?.users?.first();
      if (!target || target.id === userId) return send("Usage: `!rob @user`"), true;
      const cd = getCooldownRemaining(guildId, userId, "rob");
      if (cd > 0) return send(`\u23f0 You need to lay low. Try again in **${formatCooldown(cd)}**.`), true;
      const targetUser = getUser(guildId, target.id);
      if (targetUser.wallet < 50) return send(`<@${target.id}> doesn't have enough to rob (need at least 50 in wallet).`), true;
      if (hasItem(guildId, target.id, "padlock")) {
        consumeItem(guildId, target.id, "padlock");
        setCooldown(guildId, userId, "rob", 60_000);
        return send(`\ud83d\udd12 <@${target.id}>'s padlock stopped you! The padlock broke in the process.`), true;
      }
      const hasMask = hasItem(guildId, userId, "robbers_mask");
      const successChance = hasMask ? 0.55 : 0.4;
      if (hasMask) consumeItem(guildId, userId, "robbers_mask");
      setCooldown(guildId, userId, "rob", 120_000);
      if (Math.random() < successChance) {
        const stolen = rand(Math.floor(targetUser.wallet * 0.1), Math.floor(targetUser.wallet * 0.4));
        removeMoney(guildId, target.id, stolen);
        addMoney(guildId, userId, stolen);
        return send(pick(ROB_SUCCESS).replace("{amount}", formatCoins(stolen))), true;
      } else {
        const fine = rand(50, 200);
        removeMoney(guildId, userId, fine);
        return send(pick(ROB_FAIL).replace("{fine}", formatCoins(fine))), true;
      }
    }

    case "give":
    case "pay": {
      const target = message.mentions?.users?.first();
      if (!target || target.id === userId) return send("Usage: `!give @user <amount>`"), true;
      const stripped = args.replace(/<@!?\d+>/g, "").trim();
      const amount = parseInt(stripped);
      if (!amount || amount <= 0) return send("Usage: `!give @user <amount>`"), true;
      const u = getUser(guildId, userId);
      if (amount > u.wallet) return send(`You only have ${formatCoins(u.wallet)} in your wallet.`), true;
      removeMoney(guildId, userId, amount);
      addMoney(guildId, target.id, amount);
      return send(`\ud83d\udce8 You gave ${formatCoins(amount)} to <@${target.id}>.`), true;
    }

    case "leaderboard":
    case "lb": {
      const lb = getLeaderboard(guildId);
      if (lb.length === 0) return send("No one has any money yet!"), true;
      const medals = ["\ud83e\udd47", "\ud83e\udd48", "\ud83e\udd49"];
      const lines = lb.map((entry, i) => {
        const prefix = medals[i] || `\`${String(i + 1).padStart(2, " ")}.\``;
        return `${prefix} <@${entry.userId}> \u2014 ${formatCoins(entry.total)}`;
      });
      return sendEmbed({
        color: 0xfee75c,
        title: "\ud83c\udfc6  Leaderboard",
        description: lines.join("\n"),
        footer: { text: `Top ${lb.length} richest players` },
      }), true;
    }

    case "shop":
    case "s": {
      const fields = SHOP_ITEMS.map((item) => ({
        name: `${item.name}  \u2014  ${formatCoins(item.price)}`,
        value: `${item.description}\n\`!buy ${item.id}\``,
        inline: false,
      }));
      return sendEmbed({
        color: 0xeb459e,
        title: "\ud83d\uded2  Shop",
        description: "Buy items to gain an edge! Use `!buy <item>` to purchase.",
        fields,
        footer: { text: "Items are consumed on use" },
      }), true;
    }

    case "buy":
    case "b": {
      const itemId = args.toLowerCase().trim().replace(/\s+/g, "_");
      if (!itemId) return send("Usage: `!buy <item id>` \u2014 check `!shop` for items."), true;
      const result = buyItem(guildId, userId, itemId);
      if (result.error) return send(result.error), true;
      return send(`\u2705 You bought **${result.item.name}**!`), true;
    }

    case "inventory":
    case "inv": {
      const u = getUser(guildId, userId);
      if (u.inventory.length === 0) return sendEmbed({
        color: 0x99aab5,
        title: "\ud83c\udf92  Inventory",
        description: "Your inventory is empty.\nCheck `!shop` to buy items!",
      }), true;
      const counts = {};
      for (const item of u.inventory) {
        counts[item.id] = (counts[item.id] || 0) + 1;
      }
      const lines = Object.entries(counts).map(([id, count]) => {
        const def = SHOP_ITEMS.find((i) => i.id === id);
        return `**${def?.name || id}** \u00d7${count}`;
      });
      return sendEmbed({
        color: 0x99aab5,
        title: "\ud83c\udf92  Inventory",
        description: lines.join("\n"),
        footer: { text: `${u.inventory.length} item(s) total` },
      }), true;
    }

    case "stats":
    case "st": {
      const target = message.mentions?.users?.first() || message.author;
      const u = getUser(guildId, target.id);
      const level = getJobLevel(guildId, target.id);
      const job = JOBS.find((j) => j.id === u.job);
      const name = target.id === userId ? "Your" : `${target.username}'s`;
      return sendEmbed({
        color: 0x5865f2,
        title: `\ud83d\udcca  ${name} Stats`,
        fields: [
          { name: "Job", value: `${job?.name || "Unemployed"} (Lv. ${level})`, inline: true },
          { name: "Times Worked", value: `${u.stats.timesWorked}`, inline: true },
          { name: "Quests Done", value: `${u.stats.questsCompleted}`, inline: true },
          { name: "Gambles Won", value: `${u.stats.gamblingWon}`, inline: true },
          { name: "Gambles Lost", value: `${u.stats.gamblingLost}`, inline: true },
          { name: "Total Earned", value: formatCoins(u.stats.totalEarned), inline: true },
        ],
      }), true;
    }

    case "economy":
    case "eco": {
      await message.channel.send({ embeds: [{
        color: 0xf59e0b,
        title: "\ud83d\udcb0  Economy Commands",
        description: "Earn coins, climb the leaderboard, and collect items!\nHere's everything you can do:",
        fields: [
          { name: "\ud83d\udcb5  Money", value: "`!bal` \u2014 Check your wallet & bank\n`!d` \u2014 Claim daily reward (24h)\n`!dep <amt>` \u2014 Deposit into bank\n`!with <amt>` \u2014 Withdraw from bank\n`!give @user <amt>` \u2014 Send coins", inline: true },
          { name: "\ud83d\udcbc  Work", value: "`!j` \u2014 Browse available jobs\n`!ap <job>` \u2014 Apply for a job\n`!w` \u2014 Work your job for coins\n`!q` \u2014 Get or check a quest", inline: true },
          { name: "\ud83c\udfb0  Gambling", value: "`!cf <amt>` \u2014 Coinflip\n`!sl <amt>` \u2014 Slot machine\n`!bj <amt>` \u2014 Blackjack\n`!r @user` \u2014 Rob someone", inline: true },
          { name: "\u200b", value: "\u200b", inline: false },
          { name: "\ud83d\udce6  Other", value: "`!s` \u2014 Shop \u00b7 `!b <item>` \u2014 Buy \u00b7 `!inv` \u2014 Inventory \u00b7 `!lb` \u2014 Leaderboard \u00b7 `!st` \u2014 Stats", inline: false },
        ],
        footer: { text: "Amounts can be a number or \"all\"  \u2022  Aliases shown are the shortest form" },
      }] }).catch(() => {});
      return true;
    }

    default:
      return false;
  }
}

export const ECONOMY_COMMAND_NAMES = new Set([
  "balance", "bal", "deposit", "dep", "withdraw", "with",
  "daily", "d", "work", "w", "jobs", "j", "apply", "ap", "quest", "q",
  "coinflip", "cf", "slots", "sl", "blackjack", "bj",
  "rob", "r", "give", "pay", "leaderboard", "lb",
  "shop", "s", "buy", "b", "inventory", "inv", "stats", "st",
  "economy", "eco",
]);
