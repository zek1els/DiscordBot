import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_DATA_DIR = join(__dirname, "..", "data");

/** Railway sets this when running on their platform; use /data volume by default. */
const RAILWAY_DATA_DIR = "/data";

/**
 * Base directory for persistent data (schedules, saved messages, custom commands, deleted-log config).
 * Uses DATA_DIR if set; on Railway (when RAILWAY_ENVIRONMENT is set) defaults to /data so your volume is used.
 */
export function getDataDir() {
  const env = process.env.DATA_DIR;
  if (env && typeof env === "string" && env.trim()) {
    return env.trim();
  }
  if (process.env.RAILWAY_ENVIRONMENT) {
    return RAILWAY_DATA_DIR;
  }
  return DEFAULT_DATA_DIR;
}
