import { randomInt } from "crypto";

// Resend (HTTP API) — preferred, works on Railway/cloud platforms
const RESEND_API_KEY = process.env.RESEND_API_KEY?.trim();
const RESEND_FROM = process.env.RESEND_FROM?.trim() || "kovabot@kova.lol";

// Legacy SMTP fallback (kept for backwards compat)
const SMTP_HOST = process.env.SMTP_HOST?.trim();
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_USER = process.env.SMTP_USER?.trim();
const SMTP_PASS = process.env.SMTP_PASS?.trim();
const SMTP_FROM = process.env.SMTP_FROM?.trim() || SMTP_USER;

const CODE_LENGTH = 6;
const CODE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

/** @type {Map<string, { code: string, expiresAt: number }>} */
const pendingCodes = new Map();

/** @type {Map<string, { email: string, password: string, expiresAt: number }>} */
const pendingRegistrations = new Map();

/** Returns true if any email provider is configured (Resend or SMTP). */
export function isSmtpConfigured() {
  return !!(RESEND_API_KEY || (SMTP_HOST && SMTP_USER && SMTP_PASS));
}

function generateCode() {
  const max = Math.pow(10, CODE_LENGTH);
  return String(randomInt(0, max)).padStart(CODE_LENGTH, "0");
}

/**
 * Send email via Resend HTTP API.
 * @returns {Promise<boolean>}
 */
async function sendViaResend(to, subject, text, html) {
  try {
    console.log(`Sending email to ${to} via Resend (from: ${RESEND_FROM})`);
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: RESEND_FROM, to: [to], subject, text, html }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.error(`Resend API error (${res.status}):`, err);
      return false;
    }
    const data = await res.json().catch(() => ({}));
    console.log(`Email sent via Resend to ${to}, id: ${data.id || "?"}`);
    return true;
  } catch (e) {
    console.error(`Resend send failed for ${to}:`, e.message);
    return false;
  }
}

/**
 * Send email via SMTP (nodemailer) — fallback.
 * @returns {Promise<boolean>}
 */
async function sendViaSmtp(to, subject, text, html) {
  try {
    // Dynamic import so nodemailer isn't required when using Resend
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.default.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    console.log(`Sending email to ${to} via SMTP ${SMTP_HOST}:${SMTP_PORT}`);
    await transporter.sendMail({ from: SMTP_FROM, to, subject, text, html });
    console.log(`Email sent via SMTP to ${to}`);
    return true;
  } catch (e) {
    console.error(`SMTP send failed for ${to}:`, e.message, e.code || "", e.response || "");
    return false;
  }
}

/**
 * Generate and send a verification code to the given email.
 * @param {string} email
 * @returns {Promise<boolean>} true if sent successfully
 */
export async function sendVerificationCode(email) {
  if (!isSmtpConfigured()) return false;

  const code = generateCode();
  pendingCodes.set(email.toLowerCase(), { code, expiresAt: Date.now() + CODE_EXPIRY_MS });

  const subject = "Your verification code";
  const text = `Your verification code is: ${code}\n\nThis code expires in 10 minutes.`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 420px; margin: 0 auto; padding: 32px;">
      <h2 style="margin: 0 0 8px;">Verify your email</h2>
      <p style="color: #555; margin: 0 0 24px;">Enter this code to complete your registration:</p>
      <div style="background: #f0f0f0; border-radius: 8px; padding: 20px; text-align: center; font-size: 32px; letter-spacing: 8px; font-weight: 700; font-family: monospace;">${code}</div>
      <p style="color: #888; font-size: 13px; margin-top: 24px;">This code expires in 10 minutes. If you didn't request this, ignore this email.</p>
    </div>
  `;

  // Prefer Resend, fall back to SMTP
  if (RESEND_API_KEY) {
    return sendViaResend(email, subject, text, html);
  }
  return sendViaSmtp(email, subject, text, html);
}

/**
 * Check if the code matches for the given email.
 * @param {string} email
 * @param {string} code
 * @returns {"ok" | "expired" | "invalid"}
 */
export function verifyCode(email, code) {
  const key = email.toLowerCase();
  const entry = pendingCodes.get(key);
  if (!entry) return "invalid";
  if (Date.now() > entry.expiresAt) {
    pendingCodes.delete(key);
    return "expired";
  }
  if (entry.code !== code.trim()) return "invalid";
  pendingCodes.delete(key);
  return "ok";
}

/**
 * Store a pending registration (email + password) until the code is verified.
 * @param {string} email
 * @param {string} password
 */
export function setPendingRegistration(email, password) {
  pendingRegistrations.set(email.toLowerCase(), {
    email: email.toLowerCase(),
    password,
    expiresAt: Date.now() + CODE_EXPIRY_MS,
  });
}

/**
 * Retrieve and remove a pending registration after successful verification.
 * @param {string} email
 * @returns {{ email: string, password: string } | null}
 */
export function popPendingRegistration(email) {
  const key = email.toLowerCase();
  const entry = pendingRegistrations.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    pendingRegistrations.delete(key);
    return null;
  }
  pendingRegistrations.delete(key);
  return { email: entry.email, password: entry.password };
}

/**
 * Check if a pending registration exists (for resend).
 * @param {string} email
 * @returns {boolean}
 */
export function hasPendingRegistration(email) {
  const key = email.toLowerCase();
  const entry = pendingRegistrations.get(key);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    pendingRegistrations.delete(key);
    return false;
  }
  return true;
}

// Clean expired codes and pending registrations every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingCodes) {
    if (now > v.expiresAt) pendingCodes.delete(k);
  }
  for (const [k, v] of pendingRegistrations) {
    if (now > v.expiresAt) pendingRegistrations.delete(k);
  }
}, 5 * 60 * 1000);
