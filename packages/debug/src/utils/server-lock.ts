import fs from "node:fs";
import path from "node:path";
import type { ServerLock } from "../types.js";

const LOCK_FILENAME = "debug-server.lock";

const getLockPath = (directory: string): string => path.join(directory, LOCK_FILENAME);

const isServerLock = (value: unknown): value is ServerLock =>
  typeof value === "object" &&
  value !== null &&
  "host" in value &&
  typeof value.host === "string" &&
  "port" in value &&
  typeof value.port === "number";

export const readServerLock = (directory: string): ServerLock | null => {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(getLockPath(directory), "utf-8"));
    return isServerLock(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

// Write to a temp file then rename so a concurrent reader never sees a torn lock.
export const writeServerLock = (directory: string, lock: ServerLock): void => {
  const lockPath = getLockPath(directory);
  const temporaryPath = `${lockPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(lock, null, 2));
  fs.renameSync(temporaryPath, lockPath);
};

export const removeServerLock = (directory: string): void => {
  try {
    fs.unlinkSync(getLockPath(directory));
  } catch {}
};
