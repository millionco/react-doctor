import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  GIT_LS_FILES_MAX_BUFFER_BYTES,
  IGNORED_DIRECTORIES,
  SOURCE_FILE_PATTERN,
} from "../constants.js";

const countSourceFilesViaFilesystem = (rootDirectory: string): number => {
  let count = 0;
  const stack = [rootDirectory];

  while (stack.length > 0) {
    const currentDirectory = stack.pop()!;
    const entries = fs.readdirSync(currentDirectory, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && !IGNORED_DIRECTORIES.has(entry.name)) {
          stack.push(path.join(currentDirectory, entry.name));
        }
        continue;
      }
      if (entry.isFile() && SOURCE_FILE_PATTERN.test(entry.name)) {
        count++;
      }
    }
  }

  return count;
};

const countSourceFilesViaGit = (rootDirectory: string): number | null => {
  // HACK: do NOT add --recurse-submodules — it's incompatible with
  // --others / --exclude-standard and git rejects the combination, which
  // would silently force every scan to fall back to the much slower
  // filesystem walk in countSourceFilesViaFilesystem.
  const result = spawnSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      cwd: rootDirectory,
      encoding: "utf-8",
      maxBuffer: GIT_LS_FILES_MAX_BUFFER_BYTES,
    },
  );

  if (result.error || result.status !== 0) {
    return null;
  }

  return result.stdout
    .split("\0")
    .filter((filePath) => filePath.length > 0 && SOURCE_FILE_PATTERN.test(filePath)).length;
};

export const countSourceFiles = (rootDirectory: string): number =>
  countSourceFilesViaGit(rootDirectory) ?? countSourceFilesViaFilesystem(rootDirectory);
