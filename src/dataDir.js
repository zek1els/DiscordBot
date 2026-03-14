import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_DATA_DIR = join(__dirname, "..", "data");

/**
 * Base directory for persistent data (schedules, saved messages).
 * Set DATA_DIR in env (e.g. /data on Railway volume) to persist across deploys.
 */
export function getDataDir() {
  const env = process.env.DATA_DIR;
  if (env && typeof env === "string" && env.trim()) {
    return env.trim();
  }
  return DEFAULT_DATA_DIR;
}
