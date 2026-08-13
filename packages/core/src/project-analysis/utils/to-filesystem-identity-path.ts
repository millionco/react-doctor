import * as fs from "node:fs";

export const toFilesystemIdentityPath = (filePath: string): string => {
  try {
    return fs.realpathSync.native(filePath);
  } catch {
    return filePath;
  }
};
