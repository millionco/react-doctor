import * as path from "node:path";
import { isDirectory } from "./utils/is-directory.js";
import { isFile } from "./utils/is-file.js";
import { readDirectoryEntries } from "./utils/read-directory-entries.js";

export const resolveWorkspaceDirectories = (rootDirectory: string, pattern: string): string[] => {
  const cleanPattern = pattern.replace(/["']/g, "").replace(/\/\*\*$/, "/*");

  if (!cleanPattern.includes("*")) {
    const directoryPath = path.join(rootDirectory, cleanPattern);
    if (isDirectory(directoryPath) && isFile(path.join(directoryPath, "package.json"))) {
      return [directoryPath];
    }
    return [];
  }

  const wildcardIndex = cleanPattern.indexOf("*");
  const baseDirectory = path.join(rootDirectory, cleanPattern.slice(0, wildcardIndex));
  const suffixAfterWildcard = cleanPattern.slice(wildcardIndex + 1);

  if (!isDirectory(baseDirectory)) {
    return [];
  }

  const resolved: string[] = [];
  for (const entry of readDirectoryEntries(baseDirectory)) {
    const entryPath = path.join(baseDirectory, entry.name, suffixAfterWildcard);
    if (isDirectory(entryPath) && isFile(path.join(entryPath, "package.json"))) {
      resolved.push(entryPath);
    }
  }
  return resolved;
};
