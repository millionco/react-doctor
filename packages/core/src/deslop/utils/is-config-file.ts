import { KNOWN_CONFIG_PREFIXES } from "../constants.js";

export const isConfigFile = (filePath: string): boolean => {
  const fileName = filePath.split("/").pop() ?? "";

  if (fileName.startsWith(".") && !fileName.startsWith("..")) {
    if (fileName.toLowerCase().includes("rc.")) {
      return true;
    }
  }

  return KNOWN_CONFIG_PREFIXES.some((prefix) => fileName.startsWith(prefix));
};
