import { basename } from "node:path";
import { KNOWN_CONFIG_PREFIXES } from "../constants.js";

export const isConfigFile = (filePath: string): boolean => {
  const fileName = basename(filePath);

  if (fileName.startsWith(".") && !fileName.startsWith("..")) {
    if (fileName.toLowerCase().includes("rc.")) {
      return true;
    }
  }

  return KNOWN_CONFIG_PREFIXES.some((prefix) => fileName.startsWith(prefix));
};
