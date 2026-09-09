import * as fs from "node:fs";
import { isErrnoException } from "./is-errno-exception.js";

// True only when nothing exists at the path (a dangling symlink included);
// permission or I/O failures are not "missing" and return false.
export const isMissingPath = (absolutePath: string): boolean => {
  try {
    fs.statSync(absolutePath);
    return false;
  } catch (error) {
    return isErrnoException(error) && error.code === "ENOENT";
  }
};
