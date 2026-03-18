import { randomBytes } from "crypto";
import { create as createUser, validate as validateUser, getByEmail, getByDiscordId, setDiscord, unsetDiscord, hasAnyUser } from "../users.js";
import { isSmtpConfigured, sendVerificationCode, verifyCode, setPendingRegistration, popPendingRegistration, hasPendingRegistration } from "../emailVerification.js";

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID?.trim();
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET?.trim();
const PUBLIC_URL = (() => {
  const u = process.env.PUBLIC_URL?.trim() || "";
  if (u && /your-app\.up\.railway\.app|example\.com|localhost/i.test(u)) return "";
  return u;
})();

/**
 * Register all auth-related routes on the Express app.
 * @param {import("express").Express} app
 * @param {object} helpers
 */
export function registerAuthRoutes(app, { sessions, sessionSet, sessionDelete, getCookie, getCurrentUser, getOwnerId, isAuthenticated, isAdmin }) {
  app.post("/api/auth/register", async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });
    const trimmedEmail = String(email).trim();
    const pw = String(password);
    if (pw.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
    if (getByEmail(trimmedEmail)) {
      return res.status(400).json({ error: "An account with this email already exists" });
    }
    const needsVerification = isSmtpConfigured();
    if (needsVerification) {
      setPendingRegistration(trimmedEmail, pw);
      const sent = await sendVerificationCode(trimmedEmail);
      return res.json({ ok: true, needsVerification: true, email: trimmedEmail.toLowerCase(), emailFailed: !sent });
    }
    try {
      createUser(trimmedEmail, pw, { verified: true });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    const user = validateUser(trimmedEmail, pw);
    if (!user) return res.status(500).json({ error: "Account created but login failed" });
    const sessionToken = randomBytes(24).toString("hex");
    sessionSet(sessionToken, { userId: user.id, email: user.email, discordId: user.discordId, username: user.discordUsername });
    res.setHeader("Set-Cookie", "admin_session=" + sessionToken + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800");
    return res.json({ ok: true, user: { email: user.email, discordId: user.discordId, username: user.discordUsername } });
  });

  app.post("/api/auth/verify", (req, res) => {
    const { email, code } = req.body || {};
    if (!email || !code) return res.status(400).json({ error: "Email and code required" });
    const trimmedEmail = String(email).trim();
    const result = verifyCode(trimmedEmail, String(code));
    if (result === "expired") return res.status(400).json({ error: "Code expired. Click resend to get a new one." });
    if (result === "invalid") return res.status(400).json({ error: "Invalid code. Check your email and try again." });
    const pending = popPendingRegistration(trimmedEmail);
    if (!pending) {
      return res.status(400).json({ error: "Registration expired. Please register again." });
    }
    try {
      createUser(pending.email, pending.password, { verified: true });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    const user = getByEmail(trimmedEmail);
    if (!user) return res.status(500).json({ error: "User not found" });
    const sessionToken = randomBytes(24).toString("hex");
    sessionSet(sessionToken, { userId: user.id, email: user.email });
    res.setHeader("Set-Cookie", "admin_session=" + sessionToken + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800");
    return res.json({ ok: true, user: { email: user.email } });
  });

  app.post("/api/auth/resend-code", async (req, res) => {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "Email required" });
    const trimmedEmail = String(email).trim();
    if (!hasPendingRegistration(trimmedEmail)) {
      return res.status(404).json({ error: "No pending registration for this email. Please register again." });
    }
    const sent = await sendVerificationCode(trimmedEmail);
    if (!sent) return res.status(500).json({ error: "Failed to send email. Please try again." });
    return res.json({ ok: true });
  });

  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });
    const user = validateUser(String(email).trim(), String(password));
    if (!user) return res.status(401).json({ error: "Invalid email or password" });
    if (!user.verified) {
      return res.status(403).json({ error: "Email not verified. Please register again to verify your email." });
    }
    const sessionToken = randomBytes(24).toString("hex");
    sessionSet(sessionToken, { userId: user.id, email: user.email, discordId: user.discordId, username: user.discordUsername });
    res.setHeader("Set-Cookie", "admin_session=" + sessionToken + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800");
    return res.json({ ok: true, user: { email: user.email, discordId: user.discordId, username: user.discordUsername } });
  });

  app.get("/api/auth/discord", (req, res) => {
    if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !PUBLIC_URL) {
      return res.status(503).json({ error: "Discord not configured (DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, PUBLIC_URL)" });
    }
    const redirectUri = PUBLIC_URL.replace(/\/$/, "") + "/api/auth/discord/callback";
    const isLink = req.query.link === "1";
    const sessionToken = getCookie(req, "admin_session");
    const session = sessionToken ? sessions.get(sessionToken) : null;
    if (isLink && (!session || !session.userId)) {
      return res.redirect("/?error=link_requires_login");
    }
    const url = new URL("https://discord.com/api/oauth2/authorize");
    url.searchParams.set("client_id", DISCORD_CLIENT_ID);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "identify");
    url.searchParams.set("state", isLink ? "link" : "login");
    res.redirect(url.toString());
  });

  app.get("/api/auth/discord/callback", async (req, res) => {
    const { code, state } = req.query;
    if (!code || !DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !PUBLIC_URL) {
      return res.redirect("/?error=discord_config");
    }
    const redirectUri = PUBLIC_URL.replace(/\/$/, "") + "/api/auth/discord/callback";
    const isLink = state === "link";
    const sessionToken = getCookie(req, "admin_session");
    const session = sessionToken ? sessions.get(sessionToken) : null;
    try {
      const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: DISCORD_CLIENT_ID,
          client_secret: DISCORD_CLIENT_SECRET,
          grant_type: "authorization_code",
          code: String(code),
          redirect_uri: redirectUri,
        }),
      });
      if (!tokenRes.ok) {
        const err = await tokenRes.text();
        return res.redirect("/?error=discord_token&m=" + encodeURIComponent(err.slice(0, 80)));
      }
      const tokenData = await tokenRes.json();
      const userRes = await fetch("https://discord.com/api/users/@me", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (!userRes.ok) return res.redirect("/?error=discord_user");
      const discordUser = await userRes.json();
      const discordId = discordUser.id;
      const username = discordUser.username || discordUser.global_name || "User";
      if (isLink && session?.userId) {
        setDiscord(session.userId, discordId, username);
        sessionSet(sessionToken, { ...session, discordId, username });
        return res.redirect("/?linked=1");
      }
      const appUser = getByDiscordId(discordId);
      if (appUser) {
        const sessionTokenNew = randomBytes(24).toString("hex");
        sessionSet(sessionTokenNew, { userId: appUser.id, email: appUser.email, discordId: appUser.discordId, username: appUser.discordUsername });
        res.setHeader("Set-Cookie", "admin_session=" + sessionTokenNew + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800");
        return res.redirect("/");
      }
      return res.redirect("/?error=discord_not_linked");
    } catch (e) {
      console.error("Discord OAuth error:", e);
      return res.redirect("/?error=discord_failed");
    }
  });

  app.post("/api/auth/unlink-discord", (req, res) => {
    const user = getCurrentUser(req);
    if (!user || !user.userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      unsetDiscord(user.userId);
      const token = getCookie(req, "admin_session");
      if (token && sessions.has(token)) {
        const s = sessions.get(token);
        sessionSet(token, { userId: s.userId, email: s.email });
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/logout", (req, res) => {
    const token = getCookie(req, "admin_session");
    if (token) sessionDelete(token);
    res.setHeader("Set-Cookie", "admin_session=; Path=/; HttpOnly; Max-Age=0");
    res.json({ ok: true });
  });

  app.get("/api/auth/check", (req, res) => {
    if (!isAuthenticated(req)) return res.status(401).json({ ok: false });
    const user = getCurrentUser(req);
    res.json({
      ok: true,
      isAdmin: isAdmin(req),
      user: user ? { email: user.email, discordId: user.discordId, username: user.username } : null,
    });
  });

  app.get("/api/auth/config", (req, res) => {
    res.json({
      discordLogin: !!(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET && PUBLIC_URL),
      canRegister: true,
      emailVerification: isSmtpConfigured(),
    });
  });

  app.get("/api/auth/redirect-uri", (req, res) => {
    const redirectUri = PUBLIC_URL ? PUBLIC_URL.replace(/\/$/, "") + "/api/auth/discord/callback" : null;
    res.json({
      redirectUri,
      publicUrl: PUBLIC_URL || null,
      hint: redirectUri
        ? "Add this EXACT URL in Discord Developer Portal → your app → OAuth2 → Redirects (https, no trailing slash)."
        : "Set PUBLIC_URL in your environment to your app's public URL (e.g. https://your-app.up.railway.app).",
    });
  });
}
