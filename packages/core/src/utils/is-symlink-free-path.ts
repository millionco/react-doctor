import * as fs from "node:fs";
import * as path from "node:path";
import { isErrnoException } from "./is-errno-exception.js";
import { isPathInsideDirectory } from "./is-path-inside-directory.js";

export const isSymlinkFreePath = (filePath: string, rootDirectory: string): boolean => {
  if (!isPathInsideDirectory(filePath, rootDirectory)) return false;
  let currentPath = rootDirectory;
  for (const segment of path.relative(rootDirectory, filePath).split(path.sep)) {
    currentPath = path.join(currentPath, segment);
    try {
      if (fs.lstatSync(currentPath).isSymbolicLink()) return false;
    } catch (error) {
      return isErrnoException(error) && error.code === "ENOENT";
    }
  }
  return true;
};
