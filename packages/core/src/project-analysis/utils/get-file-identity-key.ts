import { statSync } from "node:fs";
import { resolve } from "node:path";
import { toPosixPath } from "./to-posix-path.js";

export const getFileIdentityKey = (filePath: string): string => {
  try {
    const fileStats = statSync(filePath);
    return `${fileStats.dev}:${fileStats.ino}`;
  } catch {
    return toPosixPath(resolve(filePath)).toLowerCase();
  }
};
