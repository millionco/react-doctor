import fs from "node:fs";
import path from "node:path";
import { toForwardSlashes } from "./path-format.js";

const isSafeRelativePath = (filePath: string): boolean => {
  if (filePath.length === 0) return false;
  if (filePath.includes("\0")) return false;
  if (path.isAbsolute(filePath)) return false;
  const normalized = path.posix.normalize(filePath);
  if (normalized === "." || normalized.startsWith("../") || normalized === "..") return false;
  return normalized === filePath;
};

export const readChangedFilesFrom = (filePath: string): string[] => {
  const raw = fs.readFileSync(filePath, "utf8");
  const uniqueFiles = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const candidate = toForwardSlashes(line.trim());
    if (!isSafeRelativePath(candidate)) continue;
    uniqueFiles.add(candidate);
  }
  return [...uniqueFiles];
};
