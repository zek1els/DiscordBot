import { randomInt } from "crypto";
import nodemailer from "nodemailer";

const SMTP_HOST = process.env.SMTP_HOST?.trim();
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_USER = process.env.SMTP_USER?.trim();
const SMTP_PASS = process.env.SMTP_PASS?.trim();
const SMTP_FROM = process.env.SMTP_FROM?.trim() || SMTP_USER;

const CODE_LENGTH = 6;
const CODE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

/** @type {Map<string, { code: string, expiresAt: number }>} */
const pendingCodes = new Map();

export function isSmtpConfigured() {
  return !!(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

function getTransporter() {
  if (!isSmtpConfigured()) return null;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

function generateCode() {
  const max = Math.pow(10, CODE_LENGTH);
  return String(randomInt(0, max)).padStart(CODE_LENGTH, "0");
}

/**
 * Generate and send a verification code to the given email.
 * @param {string} email
 * @returns {Promise<boolean>} true if sent successfully
 */
export async function sendVerificationCode(email) {
  const transporter = getTransporter();
  if (!transporter) return false;

  const code = generateCode();
  pendingCodes.set(email.toLowerCase(), { code, expiresAt: Date.now() + CODE_EXPIRY_MS });

  try {
    await transporter.sendMail({
      from: SMTP_FROM,
      to: email,
      subject: "Your verification code",
      text: `Your verification code is: ${code}\n\nThis code expires in 10 minutes.`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 420px; margin: 0 auto; padding: 32px;">
          <h2 style="margin: 0 0 8px;">Verify your email</h2>
          <p style="color: #555; margin: 0 0 24px;">Enter this code to complete your registration:</p>
          <div style="background: #f0f0f0; border-radius: 8px; padding: 20px; text-align: center; font-size: 32px; letter-spacing: 8px; font-weight: 700; font-family: monospace;">${code}</div>
          <p style="color: #888; font-size: 13px; margin-top: 24px;">This code expires in 10 minutes. If you didn't request this, ignore this email.</p>
        </div>
      `,
    });
    console.log(`Verification code sent to ${email}`);
    return true;
  } catch (e) {
    console.error(`Failed to send verification email to ${email}:`, e.message);
    return false;
  }
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

// Clean expired codes every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingCodes) {
    if (now > v.expiresAt) pendingCodes.delete(k);
  }
}, 5 * 60 * 1000);
