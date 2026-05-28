import * as fs from "node:fs";
import * as path from "node:path";
import { IGNORED_DIRECTORY_NAMES } from "../constants.js";

const listChildDirectories = (directory: string): string[] => {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && !IGNORED_DIRECTORY_NAMES.has(entry.name))
    .map((entry) => path.join(directory, entry.name));
};

const collectDirectoriesRecursively = (directory: string, depth: number): string[] => {
  if (depth <= 0) return [];
  const children = listChildDirectories(directory);
  const collected = [...children];
  for (const child of children) {
    collected.push(...collectDirectoriesRecursively(child, depth - 1));
  }
  return collected;
};

const MAX_RECURSIVE_GLOB_DEPTH = 6;

// Expands a single workspace glob into matching directories. Supports the
// common shapes seen in real monorepos: a literal path, a `prefix/*`
// single-level wildcard, and a `prefix/**` recursive wildcard. Negations and
// brace-expansions are intentionally out of scope for the PoC.
export const expandWorkspaceGlob = (rootDirectory: string, glob: string): string[] => {
  const normalized = glob.replace(/\\/g, "/").replace(/\/+$/, "");

  if (normalized.endsWith("/**")) {
    const prefix = normalized.slice(0, -"/**".length);
    return collectDirectoriesRecursively(
      path.join(rootDirectory, prefix),
      MAX_RECURSIVE_GLOB_DEPTH,
    );
  }

  if (normalized.endsWith("/*")) {
    const prefix = normalized.slice(0, -"/*".length);
    return listChildDirectories(path.join(rootDirectory, prefix));
  }

  if (!normalized.includes("*")) {
    const absolute = path.join(rootDirectory, normalized);
    return fs.existsSync(absolute) ? [absolute] : [];
  }

  return [];
};
