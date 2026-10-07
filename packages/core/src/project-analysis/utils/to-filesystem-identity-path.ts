import * as fs from "node:fs";
import { resolve } from "node:path";

export const toFilesystemIdentityPath = (filePath: string): string => {
  try {
    return fs.realpathSync.native(resolve(filePath));
  } catch {
    return resolve(filePath);
  }
};
