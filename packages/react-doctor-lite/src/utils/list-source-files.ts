import * as fs from "node:fs";
import * as path from "node:path";
import { IGNORED_DIRECTORY_NAMES, SOURCE_FILE_PATTERN } from "../constants.js";

// Walks a directory tree collecting source files the engine can parse,
// skipping the usual build / vendor directories. Returns absolute paths.
export const listSourceFiles = (rootDirectory: string): string[] => {
  const collected: string[] = [];
  const walk = (directory: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".") continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORY_NAMES.has(entry.name)) continue;
        walk(absolute);
      } else if (entry.isFile() && SOURCE_FILE_PATTERN.test(entry.name)) {
        collected.push(absolute);
      }
    }
  };
  walk(path.resolve(rootDirectory));
  return collected;
};
