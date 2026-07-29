import * as fs from "node:fs";

export const resolveRealPath = (filePath: string): string => {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return filePath;
  }
};
