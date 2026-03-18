import { createStore } from "./storage.js";

const store = createStore("saved-messages.json");

function getUserBucket(data, ownerId) {
  return data[ownerId] || {};
}

export function save(name, payload, ownerId = "_global") {
  const key = String(name).trim().toLowerCase();
  if (!key) throw new Error("Message name cannot be empty");
  const data = store.load();
  if (!data[ownerId]) data[ownerId] = {};
  data[ownerId][key] = { name: key, payload };
  store.save(data);
  return key;
}

export function get(name, ownerId = "_global") {
  const key = String(name).trim().toLowerCase();
  const data = store.load();
  const userEntry = getUserBucket(data, ownerId)[key];
  if (userEntry) return userEntry.payload;
  if (ownerId !== "_global") {
    const globalEntry = getUserBucket(data, "_global")[key];
    if (globalEntry) return globalEntry.payload;
  }
  return null;
}

export function list(ownerId = "_global") {
  const data = store.load();
  const bucket = getUserBucket(data, ownerId);
  return Object.entries(bucket).map(([key, { payload }]) => {
    const preview =
      payload?.content?.slice(0, 40) ||
      payload?.embeds?.[0]?.title ||
      payload?.embeds?.[0]?.description ||
      "";
    return { name: key, preview: (preview + "…").slice(0, 50) };
  });
}

export function remove(name, ownerId = "_global") {
  const key = String(name).trim().toLowerCase();
  const data = store.load();
  const bucket = data[ownerId];
  if (!bucket || !(key in bucket)) return false;
  delete bucket[key];
  if (Object.keys(bucket).length === 0) delete data[ownerId];
  store.save(data);
  return true;
}

export function migrateIfNeeded() {
  const data = store.load();
  const keys = Object.keys(data);
  if (keys.length === 0) return;
  const firstVal = data[keys[0]];
  if (firstVal && firstVal.payload !== undefined && firstVal.name !== undefined) {
    store.save({ _global: { ...data } });
    console.log(`Migrated ${keys.length} saved messages to new per-user format.`);
  }
}
