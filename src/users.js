import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { createStore } from "./storage.js";

const store = createStore("users.json", () => []);
const loadAll = () => store.load();
const saveAll = (data) => store.save(data);

const SALT_LEN = 16;
const KEY_LEN = 64;

function hashPassword(password, salt) {
  return scryptSync(password, salt, KEY_LEN).toString("base64");
}

function generateId() {
  return randomBytes(12).toString("hex");
}

/**
 * @typedef {{ id: string, email: string, passwordHash: string, salt: string, verified?: boolean, discordId?: string, discordUsername?: string, createdAt: string }} User
 */

/**
 * Create a new user (register). Email must be unique.
 * @param {string} email
 * @param {string} password
 * @param {{ verified?: boolean }} [opts]
 * @returns {{ id: string, email: string, verified: boolean, discordId?: string, discordUsername?: string }}
 */
export function create(email, password, opts = {}) {
  const normalized = String(email).trim().toLowerCase();
  if (!normalized) throw new Error("Email required");
  if (!password || password.length < 6) throw new Error("Password must be at least 6 characters");
  const users = loadAll();
  if (users.some((u) => u.email.toLowerCase() === normalized)) {
    throw new Error("An account with this email already exists");
  }
  const salt = randomBytes(SALT_LEN).toString("base64");
  const passwordHash = hashPassword(password, salt);
  const user = {
    id: generateId(),
    email: normalized,
    passwordHash,
    salt,
    verified: opts.verified !== false,
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  saveAll(users);
  return { id: user.id, email: user.email, verified: user.verified, discordId: user.discordId, discordUsername: user.discordUsername };
}

/**
 * Validate credentials and return user (without sensitive fields).
 * @param {string} email
 * @param {string} password
 * @returns {{ id: string, email: string, verified: boolean, discordId?: string, discordUsername?: string } | null}
 */
export function validate(email, password) {
  const normalized = String(email).trim().toLowerCase();
  const users = loadAll();
  const user = users.find((u) => u.email.toLowerCase() === normalized);
  if (!user) return null;
  const hash = hashPassword(password, user.salt);
  try {
    const bufHash = Buffer.from(hash, "base64");
    const bufStored = Buffer.from(user.passwordHash, "base64");
    if (bufHash.length !== bufStored.length || !timingSafeEqual(bufHash, bufStored)) return null;
  } catch (_) {
    return null;
  }
  return { id: user.id, email: user.email, verified: user.verified !== false, discordId: user.discordId, discordUsername: user.discordUsername };
}

/**
 * Mark a user as email-verified by email address.
 * @param {string} email
 * @returns {boolean}
 */
export function markVerified(email) {
  const normalized = String(email).trim().toLowerCase();
  const users = loadAll();
  const i = users.findIndex((u) => u.email.toLowerCase() === normalized);
  if (i === -1) return false;
  users[i].verified = true;
  saveAll(users);
  return true;
}

/**
 * Check if a user exists by email (for re-sending verification codes).
 * @param {string} email
 * @returns {{ id: string, email: string, verified: boolean } | null}
 */
export function getByEmail(email) {
  const normalized = String(email).trim().toLowerCase();
  const users = loadAll();
  const user = users.find((u) => u.email.toLowerCase() === normalized);
  if (!user) return null;
  return { id: user.id, email: user.email, verified: user.verified !== false };
}

/**
 * Find user by id.
 * @param {string} userId
 * @returns {{ id: string, email: string, verified: boolean, discordId?: string, discordUsername?: string } | null}
 */
export function getById(userId) {
  const users = loadAll();
  const user = users.find((u) => u.id === userId);
  if (!user) return null;
  return { id: user.id, email: user.email, verified: user.verified !== false, discordId: user.discordId, discordUsername: user.discordUsername };
}

/**
 * Find user by Discord ID.
 * @param {string} discordId
 * @returns {{ id: string, email: string, verified: boolean, discordId?: string, discordUsername?: string } | null}
 */
export function getByDiscordId(discordId) {
  const users = loadAll();
  const user = users.find((u) => u.discordId === discordId);
  if (!user) return null;
  return { id: user.id, email: user.email, verified: user.verified !== false, discordId: user.discordId, discordUsername: user.discordUsername };
}

/**
 * Link Discord to an existing user.
 * @param {string} userId
 * @param {string} discordId
 * @param {string} discordUsername
 */
export function setDiscord(userId, discordId, discordUsername) {
  const users = loadAll();
  const i = users.findIndex((u) => u.id === userId);
  if (i === -1) throw new Error("User not found");
  users[i].discordId = discordId;
  users[i].discordUsername = discordUsername || "";
  saveAll(users);
}

/**
 * Unlink Discord from user.
 * @param {string} userId
 */
export function unsetDiscord(userId) {
  const users = loadAll();
  const i = users.findIndex((u) => u.id === userId);
  if (i === -1) throw new Error("User not found");
  users[i].discordId = undefined;
  users[i].discordUsername = undefined;
  saveAll(users);
}

/** List all users (safe fields only, no password hashes). */
export function listUsers() {
  return loadAll().map((u) => ({
    id: u.id,
    email: u.email,
    verified: u.verified !== false,
    discordId: u.discordId,
    discordUsername: u.discordUsername,
    createdAt: u.createdAt,
  }));
}

/** Delete a user by id. Returns true if found and deleted. */
export function deleteUser(userId) {
  const users = loadAll();
  const i = users.findIndex((u) => u.id === userId);
  if (i === -1) return false;
  users.splice(i, 1);
  saveAll(users);
  return true;
}

/** Whether any user exists (so we can require auth). */
export function hasAnyUser() {
  return loadAll().length > 0;
}
