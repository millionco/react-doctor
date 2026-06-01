import fs from "node:fs";
import path from "node:path";

export interface DebugServerLock {
  pid: number;
  host: string;
  port: number;
  sessionId: string;
  endpoint: string;
  logPath: string;
}

const LOCK_FILENAME = "debug-server.lock";

const getLockPath = (directory: string): string => path.join(directory, LOCK_FILENAME);

export const readDebugServerLock = (directory: string): DebugServerLock | null => {
  const lockPath = getLockPath(directory);
  if (!fs.existsSync(lockPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(lockPath, "utf-8"));
  } catch {
    return null;
  }
};

export const writeDebugServerLock = (directory: string, lockData: DebugServerLock): void => {
  fs.writeFileSync(getLockPath(directory), JSON.stringify(lockData, null, 2));
};

export const removeDebugServerLock = (directory: string): void => {
  const lockPath = getLockPath(directory);
  if (!fs.existsSync(lockPath)) return;
  try {
    fs.unlinkSync(lockPath);
  } catch {}
};
