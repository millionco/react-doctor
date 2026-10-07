import * as fs from "node:fs";
import { isErrnoException } from "./is-errno-exception.js";

export const isMissingPath = (absolutePath: string): boolean => {
  try {
    fs.statSync(absolutePath);
    return false;
  } catch (error) {
    return isErrnoException(error) && error.code === "ENOENT";
  }
};
