import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { toPosixPath } from "./to-posix-path.js";

export const getFileIdentityKey = (filePath: string): string => {
  try {
    return toPosixPath(realpathSync.native(filePath)).toLowerCase();
  } catch {
    return toPosixPath(resolve(filePath)).toLowerCase();
  }
};
