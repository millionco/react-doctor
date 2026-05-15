import fs from "node:fs";
import path from "node:path";
import { isFile } from "./is-file.js";

export const resolveWorkspaceDirectories = (rootDirectory: string, pattern: string): string[] => {
  const cleanPattern = pattern.replace(/["']/g, "").replace(/\/\*\*$/, "/*");

  if (!cleanPattern.includes("*")) {
    const directoryPath = path.join(rootDirectory, cleanPattern);
    if (fs.existsSync(directoryPath) && isFile(path.join(directoryPath, "package.json"))) {
      return [directoryPath];
    }
    return [];
  }

  const wildcardIndex = cleanPattern.indexOf("*");
  const baseDirectory = path.join(rootDirectory, cleanPattern.slice(0, wildcardIndex));
  const suffixAfterWildcard = cleanPattern.slice(wildcardIndex + 1);

  if (!fs.existsSync(baseDirectory) || !fs.statSync(baseDirectory).isDirectory()) {
    return [];
  }

  const resolved: string[] = [];
  for (const entry of fs.readdirSync(baseDirectory)) {
    const entryPath = path.join(baseDirectory, entry, suffixAfterWildcard);
    if (
      fs.existsSync(entryPath) &&
      fs.statSync(entryPath).isDirectory() &&
      isFile(path.join(entryPath, "package.json"))
    ) {
      resolved.push(entryPath);
    }
  }
  return resolved;
};
