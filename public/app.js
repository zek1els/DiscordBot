(function () {
  "use strict";

  // --- DOM refs ---
  const guildEl = document.getElementById("guild");
  const channelEl = document.getElementById("channel");
  const contentEl = document.getElementById("content");
  const sendBtn = document.getElementById("sendBtn");
  const sendStatus = document.getElementById("sendStatus");
  const scheduleTypeEl = document.getElementById("scheduleType");
  const optsInterval = document.getElementById("optsInterval");
  const optsDaily = document.getElementById("optsDaily");
  const optsWeekly = document.getElementById("optsWeekly");
  const scheduleBtn = document.getElementById("scheduleBtn");
  const scheduleStatus = document.getElementById("scheduleStatus");
  const scheduleList = document.getElementById("scheduleList");

  const TIMEZONES = [
    "UTC", "Europe/Athens", "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Rome", "Europe/Moscow",
    "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
    "Asia/Tokyo", "Asia/Shanghai", "Asia/Kolkata", "Australia/Sydney"
  ];

  const panels = {
    landing: document.getElementById("landingPanel"),
    login: document.getElementById("loginPage"),
    register: document.getElementById("registerPage"),
    verify: document.getElementById("verifyPage"),
    app: document.getElementById("appPanel"),
  };

  let pendingVerifyEmail = "";

  // --- Helpers ---
  function esc(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }
  const fetchOpts = (opts = {}) => ({ ...opts, credentials: "include" });
  function headers() { return { "Content-Type": "application/json" }; }

  function showStatus(el, msg, isError) {
    el.textContent = msg;
    el.className = isError ? "error" : "success";
  }

  function showPanel(name) {
    for (const [key, el] of Object.entries(panels)) {
      el.style.display = key === name ? (key === "landing" ? "flex" : "block") : "none";
    }
  }

  // --- Auth ---
  async function checkAuth() {
    const r = await fetch("/api/auth/check", fetchOpts());
    if (!r.ok) return false;
    const data = await r.json().catch(() => ({}));
    window._isAdmin = !!data.isAdmin;
    window._user = data.user || null;
    return true;
  }

  const ADMIN_NAV_IDS = ["navAnalytics", "navModeration", "navModLog", "navConfessions", "navLogs", "navUsers", "navAdminDivider"];

  function showApp() {
    showPanel("app");
    if (window._isAdmin) {
      document.getElementById("adminBadge").style.display = "inline";
      document.getElementById("botServersSection").style.display = "block";
      ADMIN_NAV_IDS.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = ""; });
      loadBotServers();
    } else {
      document.getElementById("adminBadge").style.display = "none";
      document.getElementById("botServersSection").style.display = "none";
      ADMIN_NAV_IDS.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = "none"; });
    }
    const discordWrap = document.getElementById("discordLinkWrap");
    const linkText = document.getElementById("discordLinkText");
    const linkDiscordLink = document.getElementById("linkDiscordLink");
    const unlinkBtn = document.getElementById("unlinkDiscordBtn");
    if (window._user?.discordId && window._user?.username) {
      discordWrap.style.display = "inline";
      linkText.textContent = "Linked: " + (window._user.username || "Discord");
      linkText.style.display = "inline";
      linkDiscordLink.style.display = "none";
      unlinkBtn.style.display = "inline";
    } else {
      discordWrap.style.display = "inline";
      linkText.style.display = "none";
      linkDiscordLink.style.display = "inline";
      unlinkBtn.style.display = "none";
    }
    loadChannelsAndCache();
  }

  function showVerifyPage(email) {
    pendingVerifyEmail = email;
    document.getElementById("verifyEmailDisplay").textContent = email;
    document.getElementById("verifyCodeInput").value = "";
    document.getElementById("verifyStatus").textContent = "";
    showPanel("verify");
  }

  // --- Bot servers (admin) ---
  async function loadBotServers() {
    const listEl = document.getElementById("botServersList");
    const r = await fetch("/api/bot/servers", fetchOpts({ headers: headers() }));
    if (!r.ok) { listEl.innerHTML = '<li class="muted">Could not load</li>'; return; }
    const { servers } = await r.json();
    if (servers.length === 0) { listEl.innerHTML = '<li class="muted">Bot is not in any servers</li>'; return; }
    listEl.innerHTML = servers.map(s => `<li><strong>${esc(s.name)}</strong> <span class="muted" style="font-size: 0.82rem;">${s.memberCount} members</span></li>`).join("");
  }

  // --- Auth event handlers ---
  document.getElementById("logoutLink").addEventListener("click", async (e) => {
    e.preventDefault();
    await fetch("/api/logout", fetchOpts({ method: "POST" }));
    showPanel("login");
  });

  document.getElementById("registerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("registerEmail").value.trim();
    const password = document.getElementById("registerPassword").value;
    const statusEl = document.getElementById("registerStatus");
    if (!email || !password) { statusEl.textContent = "Enter email and password."; statusEl.className = "error"; return; }
    const r = await fetch("/api/auth/register", fetchOpts({ method: "POST", headers: headers(), body: JSON.stringify({ email, password }) }));
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.needsVerification) {
      showVerifyPage(data.email || email);
      if (data.emailFailed) {
        const vs = document.getElementById("verifyStatus");
        vs.textContent = "Could not send email. Click Resend to try again.";
        vs.className = "error";
      }
      return;
    }
    if (r.ok) {
      statusEl.textContent = "Account created. Loading\u2026";
      statusEl.className = "success";
      await checkAuth();
      showApp();
    } else {
      statusEl.textContent = data.error || "Registration failed.";
      statusEl.className = "error";
    }
  });

  document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;
    const statusEl = document.getElementById("loginStatus");
    if (!email || !password) { statusEl.textContent = "Enter email and password."; statusEl.className = "error"; return; }
    const r = await fetch("/api/auth/login", fetchOpts({ method: "POST", headers: headers(), body: JSON.stringify({ email, password }) }));
    const data = await r.json().catch(() => ({}));
    if (data.needsVerification) {
      showVerifyPage(data.email || email);
      return;
    }
    if (r.ok) {
      statusEl.textContent = "";
      await checkAuth();
      showApp();
    } else {
      statusEl.textContent = data.error || "Login failed.";
      statusEl.className = "error";
    }
  });

  // --- Verify page ---
  document.getElementById("verifyForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = document.getElementById("verifyCodeInput").value.trim();
    const statusEl = document.getElementById("verifyStatus");
    if (!code) { statusEl.textContent = "Enter the code from your email."; statusEl.className = "error"; return; }
    const r = await fetch("/api/auth/verify", fetchOpts({ method: "POST", headers: headers(), body: JSON.stringify({ email: pendingVerifyEmail, code }) }));
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      statusEl.textContent = "Verified! Loading\u2026";
      statusEl.className = "success";
      await checkAuth();
      showApp();
    } else {
      statusEl.textContent = data.error || "Verification failed.";
      statusEl.className = "error";
    }
  });

  document.getElementById("resendCodeLink").addEventListener("click", async (e) => {
    e.preventDefault();
    const statusEl = document.getElementById("verifyStatus");
    statusEl.textContent = "Sending\u2026";
    statusEl.className = "muted";
    const r = await fetch("/api/auth/resend-code", fetchOpts({ method: "POST", headers: headers(), body: JSON.stringify({ email: pendingVerifyEmail }) }));
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.alreadyVerified) {
      statusEl.textContent = "Already verified! Redirecting\u2026";
      statusEl.className = "success";
      await checkAuth();
      showApp();
    } else if (r.ok) {
      statusEl.textContent = "New code sent! Check your inbox.";
      statusEl.className = "success";
    } else {
      statusEl.textContent = data.error || "Failed to resend.";
      statusEl.className = "error";
    }
  });

  document.getElementById("backToLoginFromVerify").addEventListener("click", (e) => { e.preventDefault(); showPanel("login"); });
  document.getElementById("unlinkDiscordBtn").addEventListener("click", async () => {
    const r = await fetch("/api/auth/unlink-discord", fetchOpts({ method: "POST", headers: headers() }));
    if (r.ok) { await checkAuth(); showApp(); }
  });

  // --- Schedule type toggle ---
  scheduleTypeEl.addEventListener("change", () => {
    const v = scheduleTypeEl.value;
    optsInterval.style.display = v === "interval_minutes" ? "flex" : "none";
    optsDaily.style.display = v === "daily" ? "flex" : "none";
    optsWeekly.style.display = v === "weekly" ? "flex" : "none";
  });
  scheduleTypeEl.dispatchEvent(new Event("change"));

  // --- Time scrollers ---
  function fillTimeScrollers() {
    const hourOpts = Array.from({ length: 24 }, (_, i) => `<option value="${i}" ${i === 9 ? "selected" : ""}>${String(i).padStart(2, "0")}</option>`).join("");
    const minOpts = Array.from({ length: 60 }, (_, i) => `<option value="${i}" ${i === 0 ? "selected" : ""}>${String(i).padStart(2, "0")}</option>`).join("");
    const tzOpts = TIMEZONES.map(tz => `<option value="${esc(tz)}" ${tz === "UTC" ? "selected" : ""}>${esc(tz)}</option>`).join("");
    const ids = [
      "timeHourDaily", "timeMinDaily", "timeHourWeekly", "timeMinWeekly",
      "editTimeHourDaily", "editTimeMinDaily", "editTimeHourWeekly", "editTimeMinWeekly",
    ];
    const tzIds = ["timezoneDaily", "timezoneWeekly", "editTimezoneDaily", "editTimezoneWeekly"];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = id.includes("Hour") ? hourOpts : minOpts;
    });
    tzIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = tzOpts;
    });
  }

  // --- Channels ---
  guildEl.addEventListener("change", () => {
    const id = guildEl.value;
    channelEl.innerHTML = "<option value=''>Choose channel</option>";
    if (!id || !window._guildsCache) return;
    const g = window._guildsCache.guilds.find(x => x.id === id);
    if (g) g.channels.forEach(c => { channelEl.innerHTML += `<option value="${c.id}">${esc(c.name)}</option>`; });
  });

  function populateGuildChannelDropdown(guildSelectId, channelSelectId) {
    const guildSelect = document.getElementById(guildSelectId);
    const channelSelect = document.getElementById(channelSelectId);
    guildSelect.addEventListener("change", () => {
      const id = guildSelect.value;
      channelSelect.innerHTML = "<option value=''>Choose channel</option>";
      if (!id || !window._guildsCache) return;
      const g = window._guildsCache.guilds.find(x => x.id === id);
      if (g) g.channels.forEach(c => { channelSelect.innerHTML += `<option value="${c.id}">${esc(c.name)}</option>`; });
    });
  }
  populateGuildChannelDropdown("scheduleGuild", "scheduleChannel");

  async function loadChannelsAndCache() {
    const r = await fetch("/api/channels", fetchOpts({ headers: headers() }));
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      guildEl.innerHTML = "<option value=''>" + (data.error || "Load failed") + "</option>";
      return;
    }
    window._guildsCache = data;
    const guildOptions = "<option value=''>Choose server</option>" + data.guilds.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join("");
    guildEl.innerHTML = guildOptions;
    document.getElementById("scheduleGuild").innerHTML = guildOptions;
    if (window._isAdmin) loadDeletedLogConfig();
    loadSchedules();
  }

  // --- Guild dropdown helper for non-channel pages ---
  async function populateGuildSelect(selectId) {
    const select = document.getElementById(selectId);
    if (!select || select.options.length > 1) return;
    try {
      const r = await fetch("/api/guilds", fetchOpts({ headers: headers() }));
      if (r.ok) {
        const data = await r.json();
        for (const g of (data.guilds || [])) {
          const o = document.createElement("option");
          o.value = g.id; o.textContent = g.name;
          select.appendChild(o);
        }
      }
    } catch (e) {
      console.warn("Failed to populate guild select:", e.message);
    }
  }

  // --- Schedule message rows ---
  function renderScheduleMessageRow(value = "") {
    const div = document.createElement("div");
    div.className = "message-row";
    const textarea = document.createElement("textarea");
    textarea.placeholder = "Message text";
    textarea.value = value;
    textarea.style.minHeight = "60px";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-sm danger";
    btn.textContent = "Remove";
    btn.addEventListener("click", () => div.remove());
    div.appendChild(textarea);
    div.appendChild(btn);
    return div;
  }

  function getScheduleMessages() {
    return Array.from(document.querySelectorAll("#scheduleMessagesList .message-row"))
      .map(row => row.querySelector("textarea")?.value?.trim())
      .filter(Boolean);
  }

  function initScheduleMessagesList() {
    const list = document.getElementById("scheduleMessagesList");
    list.innerHTML = "";
    list.appendChild(renderScheduleMessageRow());
  }
  document.getElementById("addScheduleMessageBtn").addEventListener("click", () => {
    document.getElementById("scheduleMessagesList").appendChild(renderScheduleMessageRow());
  });
  initScheduleMessagesList();

  document.querySelectorAll("input[name=scheduleSource]").forEach(radio => {
    radio.addEventListener("change", () => {
      const useSaved = document.getElementById("scheduleSourceSaved").checked;
      document.getElementById("scheduleMessagesWrap").style.display = useSaved ? "none" : "block";
      document.getElementById("scheduleSavedWrap").style.display = useSaved ? "block" : "none";
      if (useSaved) populateScheduleSavedCheckboxes();
    });
  });

  async function populateScheduleSavedCheckboxes() {
    const wrap = document.getElementById("scheduleSavedList");
    const r = await fetch("/api/saved-messages", fetchOpts({ headers: headers() }));
    if (!r.ok) { wrap.innerHTML = '<span class="muted">Could not load</span>'; return; }
    const data = await r.json().catch(() => ({}));
    const list = Array.isArray(data.messages) ? data.messages : [];
    const names = list.map(m => m.name);
    wrap.innerHTML = names.map(name => {
      const id = "sched_saved_" + String(name).replace(/[^a-z0-9_]/gi, "_");
      return `<label style="display: inline-flex; align-items: center; gap: 0.25rem;"><input type="checkbox" name="scheduleSavedName" value="${esc(name)}" id="${id}"> ${esc(name)}</label>`;
    }).join("") || '<span class="muted">No saved messages yet. Add some on the Saved messages page.</span>';
  }

  // --- Edit schedule modal ---
  document.getElementById("editScheduleType").addEventListener("change", () => {
    const v = document.getElementById("editScheduleType").value;
    document.getElementById("editOptsInterval").style.display = v === "interval_minutes" ? "flex" : "none";
    document.getElementById("editOptsDaily").style.display = v === "daily" ? "flex" : "none";
    document.getElementById("editOptsWeekly").style.display = v === "weekly" ? "flex" : "none";
  });

  document.getElementById("editScheduleModal").addEventListener("click", function (e) {
    if (e.target === this) this.classList.remove("show");
  });
  document.getElementById("editScheduleModal").querySelector(".modal-inner").addEventListener("click", (e) => e.stopPropagation());
  document.getElementById("editScheduleCancelBtn").addEventListener("click", () => {
    document.getElementById("editScheduleModal").classList.remove("show");
  });

  document.getElementById("editAddMessageBtn").addEventListener("click", () => {
    const row = renderScheduleMessageRow();
    document.getElementById("editMessagesList").appendChild(row);
  });

  document.getElementById("editScheduleSaveBtn").addEventListener("click", async () => {
    const id = document.getElementById("editScheduleId").value;
    const scheduleType = document.getElementById("editScheduleType").value;
    const body = { scheduleType };
    body.timezone = document.getElementById("editTimezoneDaily").value || "UTC";
    const savedWrap = document.getElementById("editSavedWrap");
    const multiWrap = document.getElementById("editMessagesWrap");
    if (savedWrap && savedWrap.style.display !== "none") {
      const savedNames = Array.from(document.querySelectorAll("input[name=editSavedName]:checked")).map(cb => cb.value).filter(Boolean);
      if (savedNames.length === 0) { alert("Select at least one saved message."); return; }
      body.savedMessageNames = savedNames;
    } else if (multiWrap && multiWrap.style.display !== "none") {
      const editRows = multiWrap.querySelectorAll(".message-row");
      const messages = Array.from(editRows).map(row => row.querySelector("textarea")?.value?.trim()).filter(Boolean);
      if (messages.length === 0) { alert("Add at least one message."); return; }
      body.messages = messages;
    } else {
      body.content = document.getElementById("editContent").value.trim() || " ";
    }
    if (scheduleType === "interval_minutes") body.minutes = parseInt(document.getElementById("editMinutes").value, 10) || 5;
    if (scheduleType === "daily") {
      const h = document.getElementById("editTimeHourDaily").value;
      const m = document.getElementById("editTimeMinDaily").value;
      body.time = String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
      body.timezone = document.getElementById("editTimezoneDaily").value || "UTC";
    }
    if (scheduleType === "weekly") {
      body.day_of_week = parseInt(document.getElementById("editDayOfWeek").value, 10) ?? 0;
      const h = document.getElementById("editTimeHourWeekly").value;
      const m = document.getElementById("editTimeMinWeekly").value;
      body.time = String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
      body.timezone = document.getElementById("editTimezoneWeekly").value || "UTC";
    }
    const r = await fetch("/api/schedules/" + id, fetchOpts({ method: "PATCH", headers: headers(), body: JSON.stringify(body) }));
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      document.getElementById("editScheduleModal").classList.remove("show");
      loadSchedules();
    } else {
      alert(data.error || "Failed to update");
    }
  });

  // --- Saved messages page ---
  async function loadSavedMessagesPage() {
    const listEl = document.getElementById("savedMessagesList");
    if (!listEl) return;
    const r = await fetch("/api/saved-messages", fetchOpts({ headers: headers() }));
    if (!r.ok) { listEl.innerHTML = '<li class="muted">Could not load</li>'; return; }
    const data = await r.json().catch(() => ({}));
    const list = Array.isArray(data.messages) ? data.messages : [];
    if (list.length === 0) { listEl.innerHTML = '<li class="muted">No saved messages</li>'; return; }
    listEl.innerHTML = list.map(m => `<li><strong>${esc(m.name)}</strong> <span class="muted" style="font-size: 0.8rem;">${esc(m.preview || "")}</span> <button type="button" class="btn-sm danger" data-saved-name="${esc(m.name)}" data-action="delete-saved">Delete</button></li>`).join("");
    listEl.querySelectorAll("[data-action=delete-saved]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const name = btn.dataset.savedName;
        const r = await fetch("/api/saved-messages/" + encodeURIComponent(name), fetchOpts({ method: "DELETE", headers: headers() }));
        if (r.ok) loadSavedMessagesPage();
      });
    });
  }

  document.getElementById("savedMessageSaveBtn").addEventListener("click", async () => {
    const nameEl = document.getElementById("savedMessageName");
    const contentEl = document.getElementById("savedMessageContent");
    const statusEl = document.getElementById("savedMessageStatus");
    const name = nameEl.value.trim();
    const content = contentEl.value.trim();
    if (!name) { statusEl.textContent = "Enter a name."; statusEl.className = "error"; return; }
    const r = await fetch("/api/saved-messages", fetchOpts({ method: "POST", headers: headers(), body: JSON.stringify({ name, content }) }));
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      statusEl.textContent = "Saved.";
      statusEl.className = "success";
      nameEl.value = "";
      contentEl.value = "";
      loadSavedMessagesPage();
    } else {
      statusEl.textContent = data.error || "Failed.";
      statusEl.className = "error";
    }
  });

  // --- Custom commands page ---
  async function loadCmdGuildCommands() {
    const guildSelect = document.getElementById("cmdGuildSelect");
    const formArea = document.getElementById("cmdFormArea");
    const listEl = document.getElementById("customCommandsList");
    const prefixEl = document.getElementById("customCommandPrefix");
    const gid = guildSelect.value;
    if (!gid) { formArea.style.display = "none"; return; }
    formArea.style.display = "";
    listEl.innerHTML = '<li class="muted">Loading\u2026</li>';
    const r = await fetch("/api/custom-commands?guildId=" + encodeURIComponent(gid), fetchOpts({ headers: headers() }));
    if (!r.ok) { listEl.innerHTML = '<li class="muted">Could not load</li>'; return; }
    const data = await r.json().catch(() => ({}));
    const { prefix = "!", commands = [] } = data;
    if (prefixEl) prefixEl.textContent = prefix;
    if (commands.length === 0) {
      listEl.innerHTML = '<li class="muted">No custom commands for this server. Add one above.</li>';
      return;
    }
    listEl.innerHTML = commands.map(c => `<li><code>${esc(prefix + c.name)}</code> <span style="margin: 0 0.35rem; color: var(--text-muted);">\u2192</span> ${esc(c.template)} <button type="button" class="btn-sm danger" data-cmd-name="${esc(c.name)}" data-action="delete-custom-cmd">Delete</button></li>`).join("");
    listEl.querySelectorAll("[data-action=delete-custom-cmd]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const name = btn.dataset.cmdName;
        const r2 = await fetch("/api/custom-commands/" + encodeURIComponent(name) + "?guildId=" + encodeURIComponent(gid), fetchOpts({ method: "DELETE", headers: headers() }));
        if (r2.ok) loadCmdGuildCommands();
      });
    });
  }
  document.getElementById("cmdGuildSelect").addEventListener("change", loadCmdGuildCommands);

  async function loadCustomCommandsPage() {
    await populateGuildSelect("cmdGuildSelect");
    if (document.getElementById("cmdGuildSelect").value) loadCmdGuildCommands();
  }

  document.getElementById("customCommandSaveBtn").addEventListener("click", async () => {
    const nameEl = document.getElementById("customCommandName");
    const templateEl = document.getElementById("customCommandTemplate");
    const statusEl = document.getElementById("customCommandStatus");
    const guildId = document.getElementById("cmdGuildSelect").value;
    const name = nameEl.value.trim();
    const template = templateEl.value.trim();
    if (!guildId) { statusEl.textContent = "Select a server first."; statusEl.className = "error"; return; }
    if (!name) { statusEl.textContent = "Enter a command name."; statusEl.className = "error"; return; }
    const r = await fetch("/api/custom-commands", fetchOpts({ method: "POST", headers: headers(), body: JSON.stringify({ name, template, guildId }) }));
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      statusEl.textContent = "Saved. Users can type " + esc("!" + name) + " in chat.";
      statusEl.className = "success";
      nameEl.value = "";
      templateEl.value = "";
      loadCmdGuildCommands();
    } else {
      statusEl.textContent = data.error || "Failed.";
      statusEl.className = "error";
    }
  });

  // --- Navigation ---
  document.getElementById("appNav").addEventListener("click", (e) => {
    const a = e.target.closest("a[data-page]");
    if (!a) return;
    e.preventDefault();
    const page = a.dataset.page;
    document.querySelectorAll(".nav a").forEach(l => l.classList.remove("active"));
    a.classList.add("active");
    document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
    const panel = document.getElementById("page" + page.charAt(0).toUpperCase() + page.slice(1));
    if (panel) panel.classList.add("active");
    if (page === "saved") loadSavedMessagesPage();
    if (page === "commands") loadCustomCommandsPage();
    if (page === "economy") loadEconomyPage();
    if (page === "jail") loadJailConfigPage();
    if (page === "levels") loadLevelsPage();
    if (page === "analytics" && window._isAdmin) loadAnalyticsPage();
    if (page === "moderation" && window._isAdmin) loadModerationPage();
    if (page === "modlog" && window._isAdmin) loadModLogPage();
    if (page === "confessions" && window._isAdmin) loadConfessionsPage();
    if (page === "logs" && window._isAdmin) loadDeletedLogConfig();
    if (page === "users" && window._isAdmin) loadUsersPage();
  });

  // --- Dark mode ---
  (function initDarkMode() {
    const stored = localStorage.getItem("discord_scheduler_theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const dark = stored === "dark" || (stored !== "light" && prefersDark);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "");
    function updateLabels() {
      const isDark = document.documentElement.getAttribute("data-theme") === "dark";
      document.querySelectorAll("#darkModeBtn, #darkModeBtnLogin, #darkModeBtnRegister, #darkModeBtnVerify").forEach(b => { if (b) b.textContent = isDark ? "Light" : "Dark"; });
    }
    updateLabels();
    document.querySelectorAll("#darkModeBtn, #darkModeBtnLogin, #darkModeBtnRegister, #darkModeBtnVerify").forEach(btn => {
      if (!btn) return;
      btn.addEventListener("click", () => {
        const isDark = document.documentElement.getAttribute("data-theme") === "dark";
        document.documentElement.setAttribute("data-theme", isDark ? "" : "dark");
        localStorage.setItem("discord_scheduler_theme", isDark ? "light" : "dark");
        updateLabels();
      });
    });
  })();

  // --- Economy page ---
  async function loadEconomyPage() {
    const guildSelect = document.getElementById("ecoGuildSelect");
    const lbList = document.getElementById("ecoLeaderboard");
    const jobsList = document.getElementById("ecoJobs");
    const shopList = document.getElementById("ecoShop");
    const questsList = document.getElementById("ecoQuests");
    if (!guildSelect) return;
    try {
      const infoR = await fetch("/api/economy/info", fetchOpts({ headers: headers() }));
      if (infoR.ok) {
        const info = await infoR.json();
        jobsList.innerHTML = "";
        for (const j of (info.jobs || [])) {
          const li = document.createElement("li");
          li.innerHTML = `<span><strong>${esc(j.name)}</strong><br><span class="muted" style="font-size: 0.82rem;">${j.pay[0]}\u2013${j.pay[1]} coins &middot; cooldown: ${Math.round(j.cooldownMs / 1000)}s &middot; level ${j.requiredLevel}</span></span>`;
          jobsList.appendChild(li);
        }
        shopList.innerHTML = "";
        for (const item of (info.shop || [])) {
          const li = document.createElement("li");
          li.innerHTML = `<span><strong>${esc(item.name)}</strong> &mdash; ${item.price.toLocaleString()} coins<br><span class="muted" style="font-size: 0.82rem;">${esc(item.description)}</span></span>`;
          shopList.appendChild(li);
        }
        questsList.innerHTML = "";
        for (const q of (info.quests || [])) {
          const li = document.createElement("li");
          li.innerHTML = `<span><strong>${esc(q.description)}</strong><br><span class="muted" style="font-size: 0.82rem;">Reward: ${q.reward.toLocaleString()} coins</span></span>`;
          questsList.appendChild(li);
        }
      } else {
        console.error("economy/info failed:", infoR.status, await infoR.text().catch(() => ""));
      }
    } catch (e) { console.error("economy info error:", e); }
    await populateGuildSelect("ecoGuildSelect");
    const loadLb = async () => {
      const gid = guildSelect.value;
      lbList.innerHTML = "";
      if (!gid) { lbList.innerHTML = '<li><span class="muted">Select a server to see the leaderboard.</span></li>'; return; }
      try {
        const r = await fetch(`/api/economy/leaderboard/${gid}`, fetchOpts({ headers: headers() }));
        if (!r.ok) { lbList.innerHTML = `<li class="muted">Error ${r.status}</li>`; return; }
        const data = await r.json();
        if (!data.leaderboard || data.leaderboard.length === 0) {
          lbList.innerHTML = '<li><span class="muted">No one has earned coins yet.</span></li>';
          return;
        }
        const medals = ["\ud83e\udd47", "\ud83e\udd48", "\ud83e\udd49"];
        const rankClasses = ["gold", "silver", "bronze"];
        for (let i = 0; i < data.leaderboard.length; i++) {
          const entry = data.leaderboard[i];
          const li = document.createElement("li");
          const prefix = medals[i] || `${i + 1}.`;
          const cls = rankClasses[i] || "";
          li.innerHTML = `<span><span class="lb-rank ${cls}">${prefix}</span> <strong>${esc(entry.username)}</strong></span> <span style="font-weight: 600; color: var(--accent);">${entry.total.toLocaleString()} coins</span>`;
          lbList.appendChild(li);
        }
      } catch (e) {
        lbList.innerHTML = `<li class="muted">Failed to load leaderboard: ${esc(e.message)}</li>`;
      }
    };
    guildSelect.onchange = loadLb;
    loadLb();
  }

  // --- Jail config page ---
  async function loadJailConfigPage() {
    const listEl = document.getElementById("jailConfigList");
    const filterNote = document.getElementById("jailFilterNote");
    if (!listEl) return;
    listEl.innerHTML = '<li><span class="muted">Loading jail config...</span></li>';
    if (filterNote) filterNote.style.display = "none";

    try {
      const r = await fetch("/api/jail-config", fetchOpts({ headers: headers() }));
      if (!r.ok) {
        const errText = await r.text().catch(() => r.status);
        listEl.innerHTML = `<li><span class="muted">Error ${r.status}: ${esc(String(errText).slice(0, 200))}</span></li>`;
        return;
      }
      const data = await r.json();
      let configs = data.configs || [];

      if (!window._isAdmin) {
        if (!window._user?.discordId) {
          listEl.innerHTML = "";
          if (filterNote) {
            filterNote.textContent = "Link your Discord account to see your servers' jail configs.";
            filterNote.style.display = "block";
          }
          if (configs.length === 0) {
            listEl.innerHTML = '<li><span class="muted">No servers configured yet. Run /jail-setup in Discord.</span></li>';
          }
          return;
        }
        try {
          const ugr = await fetch("/api/user/guilds", fetchOpts({ headers: headers() }));
          if (ugr.ok) {
            const ugData = await ugr.json();
            const userGuildIds = new Set((ugData.guilds || []).map(g => g.id));
            configs = configs.filter(c => userGuildIds.has(c.guildId));
            if (filterNote) {
              filterNote.textContent = "Showing jail configs for servers you're in.";
              filterNote.style.display = "block";
            }
          }
        } catch (e) {
          console.warn("Failed to fetch user guilds:", e.message);
        }
      }

      if (configs.length === 0) {
        listEl.innerHTML = '<li><span class="muted">No servers configured yet. Run <code>/jail-setup</code> in Discord.</span></li>';
        return;
      }
      listEl.innerHTML = "";
      for (const c of configs) {
        const li = document.createElement("li");
        li.style.cssText = "flex-direction: column; align-items: flex-start;";
        const allowedText = c.allowedRoleNames && c.allowedRoleNames.length > 0
          ? c.allowedRoleNames.map(n => esc(n)).join(", ")
          : "Anyone with Manage Roles";
        const infoDiv = document.createElement("div");
        infoDiv.innerHTML = `<strong>${esc(c.guildName || c.guildId)}</strong><br>
          <span class="muted">Member role:</span> ${esc(c.memberRoleName || c.memberRoleId)}<br>
          <span class="muted">Criminal role:</span> ${esc(c.criminalRoleName || c.criminalRoleId)}<br>
          <span class="muted">Allowed to jail:</span> ${allowedText}`;
        li.appendChild(infoDiv);
        if (window._isAdmin) {
          const btn = document.createElement("button");
          btn.textContent = "Remove";
          btn.className = "btn-sm btn-secondary";
          btn.style.marginTop = "0.5rem";
          btn.onclick = async () => {
            if (!confirm("Remove jail config for this server?")) return;
            await fetch(`/api/jail-config/${c.guildId}`, fetchOpts({ method: "DELETE", headers: headers() }));
            loadJailConfigPage();
          };
          li.appendChild(btn);
        }
        listEl.appendChild(li);
      }
    } catch (e) {
      console.error("loadJailConfigPage error:", e);
      listEl.innerHTML = `<li><span class="muted">Failed to load jail config: ${esc(e.message)}</span></li>`;
    }
    try {
      const dr = await fetch("/api/debug/data", fetchOpts({ headers: headers() }));
      if (dr.ok) {
        const dd = await dr.json();
        const el = document.getElementById("jailDebugInfo");
        if (el) el.textContent = `Data dir: ${dd.dataDir} | Jail file exists: ${dd.jailConfigExists} | Guilds cached: ${dd.guildsInCache} | Config keys: ${dd.jailConfig ? Object.keys(dd.jailConfig).length : 0}`;
      }
    } catch (e) {
      console.warn("Debug data fetch failed:", e.message);
    }
  }

  // --- Users page (admin) ---
  async function loadUsersPage() {
    const listEl = document.getElementById("usersList");
    if (!listEl) return;
    listEl.innerHTML = '<li><span class="muted">Loading users...</span></li>';
    try {
      const r = await fetch("/api/admin/users", fetchOpts({ headers: headers() }));
      if (!r.ok) { listEl.innerHTML = `<li><span class="muted">Error ${r.status}</span></li>`; return; }
      const data = await r.json();
      const users = data.users || [];
      if (users.length === 0) { listEl.innerHTML = '<li><span class="muted">No registered users.</span></li>'; return; }
      listEl.innerHTML = "";
      for (const u of users) {
        const li = document.createElement("li");
        li.style.cssText = "flex-direction: column; align-items: flex-start;";
        const infoDiv = document.createElement("div");
        const verifiedBadge = u.verified
          ? '<span style="color: var(--success); font-size: 0.75rem; margin-left: 0.25rem; background: rgba(16,185,129,0.1); padding: 0.1rem 0.4rem; border-radius: 999px;">Verified</span>'
          : '<span style="color: var(--error); font-size: 0.75rem; margin-left: 0.25rem; background: rgba(239,68,68,0.1); padding: 0.1rem 0.4rem; border-radius: 999px;">Unverified</span>';
        const discordInfo = u.discordUsername
          ? `<br><span class="muted">Discord:</span> ${esc(u.discordUsername)} <span class="muted">(${esc(u.discordId || "")})</span>`
          : '<br><span class="muted">Discord: not linked</span>';
        const created = u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "Unknown";
        infoDiv.innerHTML = `<strong>${esc(u.email)}</strong>${verifiedBadge}${discordInfo}<br><span class="muted">Created:</span> ${esc(created)} <span class="muted">ID:</span> ${esc(u.id)}`;
        li.appendChild(infoDiv);
        const btn = document.createElement("button");
        btn.textContent = "Delete";
        btn.className = "btn-sm danger";
        btn.style.marginTop = "0.5rem";
        btn.onclick = async () => {
          if (!confirm("Delete account " + u.email + "? This cannot be undone.")) return;
          const dr = await fetch(`/api/admin/users/${encodeURIComponent(u.id)}`, fetchOpts({ method: "DELETE", headers: headers() }));
          const dd = await dr.json().catch(() => ({}));
          if (dr.ok) loadUsersPage();
          else alert(dd.error || "Failed to delete user.");
        };
        li.appendChild(btn);
        listEl.appendChild(li);
      }
    } catch (e) {
      console.error("loadUsersPage error:", e);
      listEl.innerHTML = `<li><span class="muted">Failed to load users: ${esc(e.message)}</span></li>`;
    }
  }

  // --- Levels page ---
  let _currentLbType = "xp";
  async function loadLevelsPage() {
    await populateGuildSelect("levelGuildSelect");
    const guildSelect = document.getElementById("levelGuildSelect");
    const loadLb = async () => {
      const gid = guildSelect.value;
      const statsBar = document.getElementById("levelStatsBar");
      const tabsWrap = document.getElementById("levelTabsWrap");
      const lbList = document.getElementById("levelLeaderboard");
      if (!gid) {
        statsBar.style.display = "none";
        tabsWrap.style.display = "none";
        return;
      }
      statsBar.style.display = "block";
      tabsWrap.style.display = "block";
      try {
        const sr = await fetch(`/api/levels/stats/${gid}`, fetchOpts({ headers: headers() }));
        if (sr.ok) {
          const stats = await sr.json();
          document.getElementById("statTotalMessages").textContent = stats.totalMessages.toLocaleString();
          document.getElementById("statTotalVc").textContent = stats.totalVcMinutes.toLocaleString();
          document.getElementById("statTotalUsers").textContent = stats.totalUsers.toLocaleString();
        }
      } catch (e) { console.warn("Stats load error:", e); }
      try {
        const r = await fetch(`/api/levels/leaderboard/${gid}?type=${_currentLbType}`, fetchOpts({ headers: headers() }));
        if (!r.ok) { lbList.innerHTML = `<li class="muted">Error ${r.status}</li>`; return; }
        const data = await r.json();
        if (!data.leaderboard || data.leaderboard.length === 0) {
          lbList.innerHTML = '<li><span class="muted">No data yet. Start chatting!</span></li>';
          return;
        }
        const medals = ["\ud83e\udd47", "\ud83e\udd48", "\ud83e\udd49"];
        const rankClasses = ["gold", "silver", "bronze"];
        lbList.innerHTML = "";
        for (let i = 0; i < data.leaderboard.length; i++) {
          const e = data.leaderboard[i];
          const li = document.createElement("li");
          const prefix = medals[i] || `${i + 1}.`;
          const cls = rankClasses[i] || "";
          const value = _currentLbType === "xp" ? `${e.xp.toLocaleString()} XP (Lv ${e.level})`
            : _currentLbType === "messages" ? `${e.totalMessages.toLocaleString()} messages`
            : `${e.vcMinutes.toLocaleString()} min`;
          li.innerHTML = `<span><span class="lb-rank ${cls}">${prefix}</span> <strong>${esc(e.username)}</strong></span> <span style="font-weight: 600; color: var(--accent);">${value}</span>`;
          lbList.appendChild(li);
        }
      } catch (e) {
        lbList.innerHTML = `<li class="muted">Failed: ${esc(e.message)}</li>`;
      }
    };
    guildSelect.onchange = loadLb;
    document.querySelectorAll(".level-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".level-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        _currentLbType = tab.dataset.lbType;
        loadLb();
      });
    });
    loadLb();
  }

  // --- Analytics page (admin) ---
  let _analyticsInterval = null;
  async function loadAnalyticsPage() {
    await populateGuildSelect("analyticsGuildSelect");
    const guildSelect = document.getElementById("analyticsGuildSelect");
    const content = document.getElementById("analyticsContent");
    const autoRefreshEl = document.getElementById("analyticsAutoRefresh");

    // Clear any previous auto-refresh
    if (_analyticsInterval) { clearInterval(_analyticsInterval); _analyticsInterval = null; }

    const load = async () => {
      const gid = guildSelect.value;
      if (!gid) { content.style.display = "none"; autoRefreshEl.style.display = "none"; return; }
      content.style.display = "block";
      autoRefreshEl.style.display = "flex";

      // Live server stats
      try {
        const r = await fetch(`/api/stats/${gid}`, fetchOpts({ headers: headers() }));
        if (r.ok) {
          const s = await r.json();
          document.getElementById("aStatMembers").textContent = s.memberCount?.toLocaleString() || "-";
          document.getElementById("aStatOnline").textContent = s.online?.toLocaleString() || "0";
          document.getElementById("aStatVoice").textContent = s.voiceMembers?.toLocaleString() || "0";
          document.getElementById("aStatBoosts").textContent = s.boostCount?.toLocaleString() || "0";
          // Server header
          const iconEl = document.getElementById("aServerIcon");
          if (s.icon) { iconEl.src = s.icon; iconEl.style.display = ""; } else { iconEl.style.display = "none"; }
          document.getElementById("aServerName").textContent = s.name || "—";
          const extras = [];
          if (s.channels) extras.push(`${s.channels} channels`);
          if (s.roles) extras.push(`${s.roles} roles`);
          if (s.boostLevel > 0) extras.push(`Level ${s.boostLevel}`);
          document.getElementById("aServerExtra").textContent = extras.length ? " · " + extras.join(" · ") : "";
        }
      } catch {}

      // Activity summary
      try {
        const r = await fetch(`/api/analytics/summary/${gid}`, fetchOpts({ headers: headers() }));
        if (r.ok) {
          const s = await r.json();
          document.getElementById("aStatMsgToday").textContent = s.messagesToday?.toLocaleString() || "0";
          document.getElementById("aStatMsgWeek").textContent = s.messagesThisWeek?.toLocaleString() || "0";
          document.getElementById("aStatCmdToday").textContent = s.commandsToday?.toLocaleString() || "0";
          document.getElementById("aStatActiveToday").textContent = s.activeUsersToday?.toLocaleString() || "0";
          document.getElementById("aStatActiveWeek").textContent = s.activeUsersThisWeek?.toLocaleString() || "0";
        }
      } catch {}

      // Member growth
      try {
        const r = await fetch(`/api/analytics/growth/${gid}?days=7`, fetchOpts({ headers: headers() }));
        if (r.ok) {
          const g = await r.json();
          document.getElementById("aStatJoins").textContent = `+${g.joins}`;
          document.getElementById("aStatLeaves").textContent = `-${g.leaves}`;
          const netEl = document.getElementById("aStatNetGrowth");
          netEl.textContent = (g.net >= 0 ? "+" : "") + g.net;
          netEl.style.color = g.net > 0 ? "var(--success)" : g.net < 0 ? "var(--error)" : "";
        }
      } catch {}

      // Top commands
      const cmdList = document.getElementById("analyticsCommandsList");
      try {
        const r = await fetch(`/api/analytics/commands/${gid}?days=7`, fetchOpts({ headers: headers() }));
        if (r.ok) {
          const { commands } = await r.json();
          if (!commands || commands.length === 0) {
            cmdList.innerHTML = '<li class="muted">No command data yet.</li>';
          } else {
            cmdList.innerHTML = commands.slice(0, 10).map(c =>
              `<li><strong>/${esc(c.command || "unknown")}</strong> <span class="muted">${c.count} use${c.count !== 1 ? "s" : ""}</span></li>`
            ).join("");
          }
        }
      } catch { cmdList.innerHTML = '<li class="muted">Failed to load.</li>'; }

      // Messages per day chart
      const chartEl = document.getElementById("analyticsChart");
      try {
        const r = await fetch(`/api/analytics/messages/${gid}?days=14`, fetchOpts({ headers: headers() }));
        if (r.ok) {
          const { messages } = await r.json();
          if (!messages || messages.length === 0) {
            chartEl.innerHTML = '<span class="muted" style="font-size: 0.82rem;">No message data yet.</span>';
          } else {
            const max = Math.max(...messages.map(m => m.count), 1);
            chartEl.innerHTML = messages.map(m => {
              const pct = Math.max((m.count / max) * 100, 2);
              const label = m.date ? m.date.slice(5) : "";
              return `<div class="chart-bar-col"><span class="chart-bar-value">${m.count}</span><div class="chart-bar" style="height:${pct}%"></div><span class="chart-bar-label">${esc(label)}</span></div>`;
            }).join("");
          }
        }
      } catch { chartEl.innerHTML = '<span class="muted">Failed to load.</span>'; }

      // Peak activity hours chart
      const peakEl = document.getElementById("analyticsPeakHours");
      try {
        const r = await fetch(`/api/analytics/peak-hours/${gid}?days=7`, fetchOpts({ headers: headers() }));
        if (r.ok) {
          const { hours } = await r.json();
          if (!hours || hours.every(h => h.count === 0)) {
            peakEl.innerHTML = '<span class="muted" style="font-size: 0.82rem;">No data yet.</span>';
          } else {
            const max = Math.max(...hours.map(h => h.count), 1);
            peakEl.innerHTML = hours.map(h => {
              const pct = Math.max((h.count / max) * 100, 2);
              const label = String(h.hour).padStart(2, "0");
              const intensity = h.count / max;
              const opacity = 0.3 + intensity * 0.7;
              return `<div class="chart-bar-col"><span class="chart-bar-value">${h.count || ""}</span><div class="chart-bar" style="height:${pct}%;opacity:${opacity}"></div><span class="chart-bar-label">${label}</span></div>`;
            }).join("");
          }
        }
      } catch { peakEl.innerHTML = '<span class="muted">Failed to load.</span>'; }

      // Cache status
      try {
        const r = await fetch(`/api/analytics/cache-status/${gid}`, fetchOpts({ headers: headers() }));
        if (r.ok) {
          const cs = await r.json();
          const statusEl = document.getElementById("analyticsCacheStatus");
          if (cs.done > 0 || cs.inProgress > 0) {
            const parts = [];
            if (cs.total > 0) parts.push(`${cs.total.toLocaleString()} msgs cached`);
            if (cs.done > 0) parts.push(`${cs.done} channels done`);
            if (cs.inProgress > 0) parts.push(`${cs.inProgress} in progress`);
            if (cs.pending > 0) parts.push(`${cs.pending} pending`);
            statusEl.textContent = parts.join(" · ");
          } else {
            statusEl.textContent = "No messages cached yet";
          }
          // Show progress bar if in progress
          const progressBar = document.getElementById("cacheProgressBar");
          if (cs.inProgress > 0) {
            progressBar.style.display = "block";
            const pct = cs.channels > 0 ? Math.round(((cs.done) / cs.channels) * 100) : 0;
            document.getElementById("cacheProgressFill").style.width = pct + "%";
            document.getElementById("cacheProgressText").textContent = `${cs.done}/${cs.channels} channels · ${cs.total.toLocaleString()} messages`;
          } else {
            progressBar.style.display = "none";
          }
        }
      } catch {}

      // Update timestamp
      document.getElementById("analyticsLastUpdate").textContent = new Date().toLocaleTimeString();
    };

    guildSelect.onchange = () => {
      if (_analyticsInterval) { clearInterval(_analyticsInterval); _analyticsInterval = null; }
      load();
      // Auto-refresh every 30 seconds
      _analyticsInterval = setInterval(load, 30_000);
    };
    load();
    if (guildSelect.value) {
      _analyticsInterval = setInterval(load, 30_000);
    }

    // Cache buttons
    const startCache = async (reset) => {
      const gid = guildSelect.value;
      if (!gid) return;
      const btn = document.getElementById("cacheMessagesBtn");
      btn.disabled = true;
      btn.textContent = "Caching...";
      try {
        await fetch(`/api/analytics/cache/${gid}`, fetchOpts({
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ reset }),
        }));
        // Poll cache status every 3 seconds while in progress
        const pollId = setInterval(async () => {
          try {
            const r = await fetch(`/api/analytics/cache-status/${gid}`, fetchOpts({ headers: headers() }));
            if (r.ok) {
              const cs = await r.json();
              const progressBar = document.getElementById("cacheProgressBar");
              progressBar.style.display = "block";
              const pct = cs.channels > 0 ? Math.round(((cs.done) / cs.channels) * 100) : 0;
              document.getElementById("cacheProgressFill").style.width = pct + "%";
              document.getElementById("cacheProgressText").textContent = `${cs.done}/${cs.channels} channels · ${cs.total.toLocaleString()} messages`;
              document.getElementById("analyticsCacheStatus").textContent = `${cs.total.toLocaleString()} msgs cached · ${cs.done} channels done`;
              if (cs.inProgress === 0 && cs.pending === 0) {
                clearInterval(pollId);
                btn.disabled = false;
                btn.textContent = "Cache All Messages";
                progressBar.style.display = "none";
                load(); // Refresh all stats
              }
            }
          } catch {}
        }, 3000);
      } catch (e) {
        btn.disabled = false;
        btn.textContent = "Cache All Messages";
      }
    };
    document.getElementById("cacheMessagesBtn").onclick = () => startCache(false);
    document.getElementById("cacheResetBtn").onclick = () => {
      if (confirm("This will delete all cached message data and re-crawl every channel. Continue?")) {
        startCache(true);
      }
    };
  }

  // --- Member search helper ---
  function setupMemberSearch(searchInputId, hiddenInputId, dropdownId, getGuildId) {
    const searchInput = document.getElementById(searchInputId);
    const hiddenInput = document.getElementById(hiddenInputId);
    const dropdown = document.getElementById(dropdownId);
    let debounceTimer = null;

    searchInput.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      const q = searchInput.value.trim();
      hiddenInput.value = "";
      if (q.length < 1) { dropdown.classList.remove("open"); return; }
      debounceTimer = setTimeout(async () => {
        const gid = getGuildId();
        if (!gid) return;
        try {
          const r = await fetch(`/api/members/${gid}?q=${encodeURIComponent(q)}`, fetchOpts({ headers: headers() }));
          if (!r.ok) return;
          const { members } = await r.json();
          if (!members || members.length === 0) {
            dropdown.innerHTML = '<div class="member-option muted" style="pointer-events:none;">No members found</div>';
          } else {
            dropdown.innerHTML = members.map(m =>
              `<div class="member-option" data-id="${esc(m.id)}" data-name="${esc(m.displayName)}">
                <img src="${esc(m.avatar)}" alt="">
                <span class="member-name">${esc(m.displayName)}</span>
                <span class="member-id">${esc(m.username)}</span>
              </div>`
            ).join("");
          }
          dropdown.classList.add("open");
        } catch {}
      }, 250);
    });

    dropdown.addEventListener("click", (e) => {
      const opt = e.target.closest(".member-option");
      if (!opt || !opt.dataset.id) return;
      hiddenInput.value = opt.dataset.id;
      searchInput.value = opt.dataset.name;
      dropdown.classList.remove("open");
    });

    searchInput.addEventListener("blur", () => {
      setTimeout(() => dropdown.classList.remove("open"), 200);
    });
    searchInput.addEventListener("focus", () => {
      if (dropdown.innerHTML && searchInput.value.trim()) dropdown.classList.add("open");
    });

    return { clear() { searchInput.value = ""; hiddenInput.value = ""; dropdown.innerHTML = ""; } };
  }

  // --- Moderation page (admin) ---
  async function loadModerationPage() {
    await populateGuildSelect("modGuildSelect");
    const guildSelect = document.getElementById("modGuildSelect");
    const content = document.getElementById("modActionsContent");

    const loadWarnings = async (gid) => {
      const listEl = document.getElementById("modWarningsList");
      try {
        const r = await fetch(`/api/warnings/${gid}`, fetchOpts({ headers: headers() }));
        if (!r.ok) { listEl.innerHTML = '<li class="muted">Could not load warnings.</li>'; return; }
        const { warnings } = await r.json();
        if (!warnings || warnings.length === 0) {
          listEl.innerHTML = '<li class="muted">No warnings in this server.</li>';
          return;
        }
        listEl.innerHTML = warnings.slice(0, 50).map(w => {
          const date = new Date(w.timestamp).toLocaleString();
          return `<li style="flex-direction:column;align-items:flex-start;">
            <div><strong>${esc(w.username)}</strong> <span class="muted" style="font-size:0.78rem;">warned by ${esc(w.moderatorName)}</span></div>
            <div style="margin-top:0.25rem;">${esc(w.reason)}</div>
            <div class="muted" style="font-size:0.75rem;margin-top:0.25rem;">${esc(date)} &middot; ID: ${esc(w.id)}</div>
          </li>`;
        }).join("");
      } catch { listEl.innerHTML = '<li class="muted">Failed to load.</li>'; }
    };

    const getGid = () => guildSelect.value;
    const warnSearch = setupMemberSearch("modWarnUserSearch", "modWarnUser", "modWarnUserDropdown", getGid);
    const jailSearch = setupMemberSearch("modJailUserSearch", "modJailUser", "modJailUserDropdown", getGid);

    const onGuildChange = () => {
      const gid = guildSelect.value;
      if (!gid) { content.style.display = "none"; return; }
      content.style.display = "block";
      warnSearch.clear();
      jailSearch.clear();
      loadWarnings(gid);
    };
    guildSelect.onchange = onGuildChange;
    onGuildChange();

    // Warn button
    document.getElementById("modWarnBtn").onclick = async () => {
      const gid = guildSelect.value;
      const userId = document.getElementById("modWarnUser").value.trim();
      const reason = document.getElementById("modWarnReason").value.trim();
      const status = document.getElementById("modWarnStatus");
      if (!gid || !userId || !reason) { status.textContent = "Select a user and enter a reason."; status.className = "error"; return; }
      try {
        const r = await fetch(`/api/mod/warn/${gid}`, fetchOpts({ method: "POST", headers: headers(), body: JSON.stringify({ userId, reason }) }));
        const d = await r.json();
        if (r.ok) {
          status.textContent = `Warned. Total: ${d.total}`;
          status.className = "success";
          warnSearch.clear();
          document.getElementById("modWarnReason").value = "";
          loadWarnings(gid);
        } else { status.textContent = d.error || "Failed"; status.className = "error"; }
      } catch (e) { status.textContent = e.message; status.className = "error"; }
    };

    // Jail button
    document.getElementById("modJailBtn").onclick = async () => {
      const gid = guildSelect.value;
      const userId = document.getElementById("modJailUser").value.trim();
      const status = document.getElementById("modJailStatus");
      if (!gid || !userId) { status.textContent = "Select a user."; status.className = "error"; return; }
      try {
        const r = await fetch(`/api/mod/jail/${gid}`, fetchOpts({ method: "POST", headers: headers(), body: JSON.stringify({ userId }) }));
        const d = await r.json();
        if (r.ok) { status.textContent = "User jailed."; status.className = "success"; }
        else { status.textContent = d.error || "Failed"; status.className = "error"; }
      } catch (e) { status.textContent = e.message; status.className = "error"; }
    };

    // Unjail button
    document.getElementById("modUnjailBtn").onclick = async () => {
      const gid = guildSelect.value;
      const userId = document.getElementById("modJailUser").value.trim();
      const status = document.getElementById("modJailStatus");
      if (!gid || !userId) { status.textContent = "Select a user."; status.className = "error"; return; }
      try {
        const r = await fetch(`/api/mod/unjail/${gid}`, fetchOpts({ method: "POST", headers: headers(), body: JSON.stringify({ userId }) }));
        const d = await r.json();
        if (r.ok) { status.textContent = "User unjailed."; status.className = "success"; }
        else { status.textContent = d.error || "Failed"; status.className = "error"; }
      } catch (e) { status.textContent = e.message; status.className = "error"; }
    };
  }

  // --- Mod Log page (admin) ---
  let _modlogPage = 1;
  async function loadModLogPage() {
    await populateGuildSelect("modlogGuildSelect");
    const guildSelect = document.getElementById("modlogGuildSelect");
    const content = document.getElementById("modlogContent");
    _modlogPage = 1;

    const actionLabels = {
      join: "Join", leave: "Leave", ban: "Ban", unban: "Unban", kick: "Kick",
      jail: "Jail", unjail: "Unjail", warn: "Warn", mute: "Mute", unmute: "Unmute",
      role_add: "Role Add", role_remove: "Role Remove", nick_change: "Nick Change",
      message_delete: "Msg Delete", message_edit: "Msg Edit",
      voice_join: "Voice Join", voice_leave: "Voice Leave", voice_move: "Voice Move",
    };

    const loadLog = async () => {
      const gid = guildSelect.value;
      if (!gid) { content.style.display = "none"; return; }
      content.style.display = "block";
      const listEl = document.getElementById("modlogList");
      const pagEl = document.getElementById("modlogPagination");
      listEl.innerHTML = '<li class="muted">Loading\u2026</li>';

      const action = document.getElementById("modlogActionFilter").value;
      const userId = document.getElementById("modlogUserFilter").value.trim();
      const params = new URLSearchParams({ page: _modlogPage, limit: 50 });
      if (action) params.set("action", action);
      if (userId) params.set("userId", userId);

      try {
        const r = await fetch(`/api/modlog/${gid}?${params}`, fetchOpts({ headers: headers() }));
        if (!r.ok) { listEl.innerHTML = `<li class="muted">Error ${r.status}</li>`; return; }
        const data = await r.json();
        const entries = data.entries || [];
        if (entries.length === 0) {
          listEl.innerHTML = '<li class="muted">No entries found.</li>';
          pagEl.innerHTML = "";
          return;
        }
        listEl.innerHTML = entries.map(e => {
          const date = new Date(e.timestamp).toLocaleString();
          const badge = `<span class="audit-badge ${esc(e.action)}">${esc(actionLabels[e.action] || e.action)}</span>`;
          let detail = "";
          if (e.username) detail += ` <strong>${esc(String(e.username))}</strong>`;
          if (e.moderatorName && e.moderator_id) detail += ` <span class="muted">by ${esc(String(e.moderatorName))}</span>`;
          if (e.reason) detail += ` &mdash; ${esc(e.reason)}`;
          if (e.duration) detail += ` (${esc(e.duration)})`;
          if (e.extra) detail += ` <span class="muted" style="font-size:0.78rem;">${esc(e.extra.slice(0, 120))}</span>`;
          return `<li style="flex-direction:column;align-items:flex-start;">
            <div>${badge}${detail}</div>
            <div class="muted" style="font-size:0.72rem;margin-top:0.2rem;">${esc(date)}</div>
          </li>`;
        }).join("");

        // Pagination
        const { page, totalPages } = data;
        if (totalPages <= 1) { pagEl.innerHTML = ""; return; }
        let pag = "";
        if (page > 1) pag += `<button class="page-btn" data-p="${page - 1}">&laquo;</button>`;
        for (let i = Math.max(1, page - 2); i <= Math.min(totalPages, page + 2); i++) {
          pag += `<button class="page-btn${i === page ? " active" : ""}" data-p="${i}">${i}</button>`;
        }
        if (page < totalPages) pag += `<button class="page-btn" data-p="${page + 1}">&raquo;</button>`;
        pagEl.innerHTML = pag;
        pagEl.querySelectorAll(".page-btn").forEach(btn => {
          btn.addEventListener("click", () => { _modlogPage = parseInt(btn.dataset.p); loadLog(); });
        });
      } catch (e) { listEl.innerHTML = `<li class="muted">Failed: ${esc(e.message)}</li>`; }
    };

    const modlogMemberSearch = setupMemberSearch("modlogUserSearch", "modlogUserFilter", "modlogUserDropdown", () => guildSelect.value);
    guildSelect.onchange = () => { _modlogPage = 1; modlogMemberSearch.clear(); loadLog(); };
    document.getElementById("modlogSearchBtn").onclick = () => { _modlogPage = 1; loadLog(); };
    document.getElementById("modlogActionFilter").onchange = () => { _modlogPage = 1; loadLog(); };
    loadLog();
  }

  // --- Confessions page (admin) ---
  let _confPage = 1;
  async function loadConfessionsPage() {
    await populateGuildSelect("confessGuildSelect");
    const guildSelect = document.getElementById("confessGuildSelect");
    _confPage = 1;

    const load = async () => {
      const gid = guildSelect.value;
      const listEl = document.getElementById("confessionsList");
      const pagEl = document.getElementById("confessionsPagination");
      if (!gid) { listEl.innerHTML = '<li class="muted">Select a server.</li>'; pagEl.innerHTML = ""; return; }
      listEl.innerHTML = '<li class="muted">Loading\u2026</li>';

      try {
        const r = await fetch(`/api/confessions/${gid}?page=${_confPage}&limit=30`, fetchOpts({ headers: headers() }));
        if (!r.ok) { listEl.innerHTML = `<li class="muted">Error ${r.status}</li>`; return; }
        const data = await r.json();
        const confessions = data.confessions || [];
        if (confessions.length === 0) {
          listEl.innerHTML = '<li class="muted">No confessions yet.</li>';
          pagEl.innerHTML = "";
          return;
        }
        listEl.innerHTML = confessions.map(c => {
          const date = new Date(c.timestamp).toLocaleString();
          const userName = c.displayName || c.username || c.user_id || "unknown";
          const userTag = c.user_id ? `<span class="confession-user" title="ID: ${esc(c.user_id)}">by ${esc(userName)}</span>` : `<span class="confession-user muted">by unknown</span>`;
          return `<li class="confession-card">
            <span class="confession-number">Confession #${c.confession_number || c.id}</span>
            ${userTag}
            <div class="confession-text">${esc(c.text)}</div>
            <span class="confession-time">${esc(date)}</span>
          </li>`;
        }).join("");

        // Pagination
        const { page, totalPages } = data;
        if (totalPages <= 1) { pagEl.innerHTML = ""; return; }
        let pag = "";
        if (page > 1) pag += `<button class="page-btn" data-p="${page - 1}">&laquo;</button>`;
        for (let i = Math.max(1, page - 2); i <= Math.min(totalPages, page + 2); i++) {
          pag += `<button class="page-btn${i === page ? " active" : ""}" data-p="${i}">${i}</button>`;
        }
        if (page < totalPages) pag += `<button class="page-btn" data-p="${page + 1}">&raquo;</button>`;
        pagEl.innerHTML = pag;
        pagEl.querySelectorAll(".page-btn").forEach(btn => {
          btn.addEventListener("click", () => { _confPage = parseInt(btn.dataset.p); load(); });
        });
      } catch (e) { listEl.innerHTML = `<li class="muted">Failed: ${esc(e.message)}</li>`; }
    };

    guildSelect.onchange = () => { _confPage = 1; load(); };
    load();
  }

  // --- Deleted log config ---
  async function loadDeletedLogConfig() {
    const listEl = document.getElementById("deletedLogChannelsList");
    if (!listEl) return;
    const r = await fetch("/api/deleted-log-config", fetchOpts({ headers: headers() }));
    if (!r.ok) { listEl.innerHTML = '<li class="muted">Could not load</li>'; return; }
    const { channels } = await r.json().catch(() => ({})) || {};
    if (!Array.isArray(channels) || channels.length === 0) {
      listEl.innerHTML = '<li class="muted">No channels set. Run <code>/log-deletes here</code> in a channel.</li>';
      return;
    }
    listEl.innerHTML = channels.map(c => {
      const label = [c.guildName, c.channelName ? "#" + c.channelName : ""].filter(Boolean).join(" \u203a ") || c.channelId;
      const removeBtn = window._isAdmin ? ` <button type="button" class="btn-sm danger" data-channel-id="${esc(c.channelId)}" data-action="remove-log-channel">Remove</button>` : "";
      return `<li>${esc(label)}${removeBtn}</li>`;
    }).join("");
    listEl.querySelectorAll("[data-action=remove-log-channel]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const channelId = btn.dataset.channelId;
        const r = await fetch("/api/deleted-log-config/channel/" + encodeURIComponent(channelId), fetchOpts({ method: "DELETE", headers: headers() }));
        if (r.ok) loadDeletedLogConfig();
      });
    });
  }

  // --- Send message ---
  sendBtn.addEventListener("click", async () => {
    const channelId = channelEl.value;
    const content = contentEl.value.trim();
    if (!channelId || !content) { showStatus(sendStatus, "Pick a channel and enter message.", true); return; }
    sendBtn.disabled = true;
    const r = await fetch("/api/send", fetchOpts({ method: "POST", headers: headers(), body: JSON.stringify({ channelId, content }) }));
    const data = await r.json().catch(() => ({}));
    sendBtn.disabled = false;
    if (r.ok) showStatus(sendStatus, "Sent."); else showStatus(sendStatus, data.error || "Failed", true);
  });

  // --- Create schedule ---
  scheduleBtn.addEventListener("click", async () => {
    const channelId = document.getElementById("scheduleChannel").value;
    const scheduleType = scheduleTypeEl.value;
    const useSaved = document.getElementById("scheduleSourceSaved").checked;
    const savedNames = useSaved ? Array.from(document.querySelectorAll("input[name=scheduleSavedName]:checked")).map(cb => cb.value).filter(Boolean) : [];
    const messages = useSaved ? [] : getScheduleMessages();
    if (!channelId) { showStatus(scheduleStatus, "Pick a channel.", true); return; }
    if (!useSaved && messages.length === 0) { showStatus(scheduleStatus, "Add at least one message or use saved messages.", true); return; }
    if (useSaved && savedNames.length === 0) { showStatus(scheduleStatus, "Select at least one saved message.", true); return; }
    const body = { channelId, scheduleType, timezone: "UTC" };
    if (useSaved) body.savedMessageNames = savedNames;
    else if (messages.length === 1) body.content = messages[0];
    else body.messages = messages;
    if (scheduleType === "interval_minutes") body.minutes = parseInt(document.getElementById("minutes").value, 10) || 5;
    if (scheduleType === "daily") {
      const h = document.getElementById("timeHourDaily").value;
      const m = document.getElementById("timeMinDaily").value;
      body.time = String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
      body.timezone = document.getElementById("timezoneDaily").value || "UTC";
    }
    if (scheduleType === "weekly") {
      body.day_of_week = parseInt(document.getElementById("dayOfWeek").value, 10);
      const h = document.getElementById("timeHourWeekly").value;
      const m = document.getElementById("timeMinWeekly").value;
      body.time = String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
      body.timezone = document.getElementById("timezoneWeekly").value || "UTC";
    }
    scheduleBtn.disabled = true;
    const r = await fetch("/api/schedule", fetchOpts({ method: "POST", headers: headers(), body: JSON.stringify(body) }));
    const data = await r.json().catch(() => ({}));
    scheduleBtn.disabled = false;
    if (r.ok) { showStatus(scheduleStatus, "Scheduled: " + data.label); loadSchedules(); }
    else showStatus(scheduleStatus, data.error || "Failed", true);
  });

  // --- Schedule list ---
  function formatNextRun(nextRunAt) {
    if (!nextRunAt) return "";
    const d = new Date(nextRunAt);
    const t = d.toISOString().slice(11, 19);
    const dateStr = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined });
    return dateStr + " " + t + " UTC";
  }

  function updateNextRunCountdowns() {
    scheduleList.querySelectorAll("[data-next-run]").forEach(el => {
      const iso = el.dataset.nextRun;
      if (!iso) return;
      const diff = new Date(iso) - new Date();
      if (diff <= 0) { el.textContent = "Sending\u2026"; return; }
      const s = Math.floor(diff / 1000) % 60;
      const m = Math.floor(diff / 60000) % 60;
      const h = Math.floor(diff / 3600000) % 24;
      const d = Math.floor(diff / 86400000);
      const parts = [];
      if (d) parts.push(d + "d");
      if (h) parts.push(h + "h");
      parts.push(m + "m");
      parts.push(s + "s");
      el.textContent = "Next: " + el.dataset.nextRunFormatted + " (in " + parts.join(" ") + ")";
    });
  }

  async function loadSchedules() {
    const r = await fetch("/api/schedules", fetchOpts({ headers: headers() }));
    if (!r.ok) { scheduleList.innerHTML = "<li>Could not load schedules</li>"; return; }
    const { schedules } = await r.json();
    if (schedules.length === 0) { scheduleList.innerHTML = '<li class="muted">No scheduled messages</li>'; return; }
    scheduleList.innerHTML = schedules.map(s => {
      const where = [s.serverName, s.channelName ? "#" + s.channelName : ""].filter(Boolean).join(" \u203a ") || "Unknown channel";
      const pausedBadge = s.paused ? ' <span class="muted" style="font-weight: normal;">(Paused)</span>' : "";
      const nextRunHtml = s.paused
        ? '<span class="next-run muted">Paused</span>'
        : s.nextRunAt
          ? `<span class="next-run" data-next-run="${esc(s.nextRunAt)}" data-next-run-formatted="${esc(formatNextRun(s.nextRunAt))}"></span>`
          : '<span class="next-run muted">Next: \u2014</span>';
      return `
      <li>
        <span>
          <strong>${esc(s.label)}</strong>${pausedBadge}
          <span class="schedule-where">${esc(where)}</span>
          <span class="schedule-preview">${esc(s.preview || "")}</span>
          ${nextRunHtml}
        </span>
        <span>
          ${s.paused ? `<button class="btn-sm" data-action="resume" data-id="${esc(s.id)}">Resume</button>` : `<button class="btn-sm btn-secondary" data-action="pause" data-id="${esc(s.id)}">Pause</button>`}
          <button class="btn-sm btn-secondary" data-action="edit" data-id="${esc(s.id)}">Edit</button>
          <button class="danger btn-sm" data-action="delete" data-id="${esc(s.id)}">Delete</button>
        </span>
      </li>`;
    }).join("");
    updateNextRunCountdowns();
    if (window._nextRunInterval) clearInterval(window._nextRunInterval);
    window._nextRunInterval = setInterval(updateNextRunCountdowns, 1000);
    scheduleList.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        const action = btn.dataset.action;
        if (action === "delete") {
          const r = await fetch("/api/schedules/" + id, fetchOpts({ method: "DELETE", headers: headers() }));
          if (r.ok) loadSchedules();
          return;
        }
        if (action === "pause" || action === "resume") {
          const r = await fetch("/api/schedules/" + id, fetchOpts({ method: "PATCH", headers: headers(), body: JSON.stringify({ paused: action === "pause" }) }));
          if (r.ok) loadSchedules();
          return;
        }
        if (action === "edit") {
          const r = await fetch("/api/schedules/" + id, fetchOpts({ headers: headers() }));
          if (!r.ok) return;
          const s = await r.json();
          document.getElementById("editScheduleId").value = s.id;
          const multi = s.messages && s.messages.length > 1;
          const savedNames = Array.isArray(s.savedMessageNames) ? s.savedMessageNames : [];
          const useSaved = savedNames.length > 0;
          document.getElementById("editSingleMessageWrap").style.display = (multi || useSaved) ? "none" : "block";
          document.getElementById("editMessagesWrap").style.display = multi && !useSaved ? "block" : "none";
          document.getElementById("editSavedWrap").style.display = useSaved ? "block" : "none";
          document.getElementById("editContent").value = (s.messages && s.messages[0]) || s.content || "";
          const editList = document.getElementById("editMessagesList");
          editList.innerHTML = "";
          (s.messages || [s.content || ""]).forEach((msg) => {
            const row = renderScheduleMessageRow(msg);
            editList.appendChild(row);
          });
          (async () => {
            const savedRes = await fetch("/api/saved-messages", fetchOpts({ headers: headers() }));
            const savedData = await savedRes.json().catch(() => ({}));
            const savedList = Array.isArray(savedData.messages) ? savedData.messages : [];
            const nameSet = savedList.map(m => m.name);
            const editSavedList = document.getElementById("editSavedList");
            editSavedList.innerHTML = nameSet.map(name => {
              const cbId = "edit_saved_" + String(name).replace(/[^a-z0-9_]/gi, "_");
              const checked = savedNames.includes(name) ? " checked" : "";
              return `<label style="display: inline-flex; align-items: center; gap: 0.25rem;"><input type="checkbox" name="editSavedName" value="${esc(name)}" id="${cbId}"${checked}> ${esc(name)}</label>`;
            }).join("") || '<span class="muted">No saved messages</span>';
          })();
          document.getElementById("editScheduleType").value = s.scheduleType || "interval_minutes";
          document.getElementById("editMinutes").value = s.minutes ?? 5;
          document.getElementById("editTimeHourDaily").value = parseInt((s.time || "00:00").split(":")[0], 10) || 0;
          document.getElementById("editTimeMinDaily").value = parseInt((s.time || "00:00").split(":")[1], 10) || 0;
          document.getElementById("editTimezoneDaily").value = s.timezone || "UTC";
          document.getElementById("editDayOfWeek").value = String(s.day_of_week ?? 0);
          document.getElementById("editTimeHourWeekly").value = parseInt((s.time || "00:00").split(":")[0], 10) || 0;
          document.getElementById("editTimeMinWeekly").value = parseInt((s.time || "00:00").split(":")[1], 10) || 0;
          document.getElementById("editTimezoneWeekly").value = s.timezone || "UTC";
          document.getElementById("editScheduleType").dispatchEvent(new Event("change"));
          document.getElementById("editScheduleModal").classList.add("show");
        }
      });
    });
  }

  // --- Login panel init ---
  async function initLoginPanel() {
    const configRes = await fetch("/api/auth/config");
    const config = await configRes.json().catch(() => ({}));
    document.getElementById("discordLoginWrap").style.display = config.discordLogin ? "block" : "none";
    const hintEl = document.getElementById("redirectUriHint");
    if (hintEl) hintEl.style.display = "none";
    const link = document.getElementById("redirectUriLink");
    if (link) link.style.display = "none";
    const params = new URLSearchParams(location.search);
    const err = params.get("error");
    const linked = params.get("linked");
    const statusEl = document.getElementById("loginStatus");
    const errMsg = {
      discord_config: "Discord not configured.",
      discord_token: "Invalid redirect URI or Discord auth failed.",
      discord_user: "Could not load Discord user.",
      discord_failed: "Discord auth failed.",
      discord_not_linked: "No account linked to this Discord. Create an account and use Link Discord after logging in.",
      link_requires_login: "Log in first, then use Link Discord.",
    }[err];
    if (errMsg && statusEl) { statusEl.textContent = errMsg; statusEl.className = "error"; }
    if (linked === "1" && statusEl) { statusEl.textContent = "Discord linked successfully."; statusEl.className = "success"; }
    if (err || linked) history.replaceState({}, "", location.pathname || "/");
  }

  // --- Landing page navigation ---
  document.getElementById("landingLoginBtn").addEventListener("click", (e) => { e.preventDefault(); showPanel("login"); });
  document.getElementById("landingRegisterBtn").addEventListener("click", (e) => { e.preventDefault(); showPanel("register"); });
  document.getElementById("landingGetStartedBtn").addEventListener("click", (e) => { e.preventDefault(); showPanel("register"); });
  document.getElementById("landingLogo").addEventListener("click", (e) => { e.preventDefault(); showPanel("landing"); });
  document.getElementById("backToLandingFromLogin").addEventListener("click", (e) => { e.preventDefault(); showPanel("landing"); });
  document.getElementById("backToLandingFromRegister").addEventListener("click", (e) => { e.preventDefault(); showPanel("landing"); });
  document.getElementById("goToRegisterFromLogin").addEventListener("click", (e) => { e.preventDefault(); showPanel("register"); });
  document.getElementById("goToLoginFromRegister").addEventListener("click", (e) => { e.preventDefault(); showPanel("login"); });

  // --- Boot ---
  (async () => {
    fillTimeScrollers();
    await initLoginPanel();
    const ok = await checkAuth();
    if (ok) {
      showApp();
    } else {
      const params = new URLSearchParams(location.search);
      if (params.get("error") || params.get("linked")) showPanel("login");
      else showPanel("landing");
    }
  })();
})();
