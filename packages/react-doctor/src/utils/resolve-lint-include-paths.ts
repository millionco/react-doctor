import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  GIT_LS_FILES_MAX_BUFFER_BYTES,
  IGNORED_DIRECTORIES,
  JSX_FILE_PATTERN,
  SOURCE_FILE_PATTERN,
} from "../constants.js";
import type { ReactDoctorConfig } from "../types.js";
import { compileIgnoredFilePatterns, isFileIgnoredByPatterns } from "./is-ignored-file.js";

const listSourceFilesViaGit = (rootDirectory: string): string[] | null => {
  const result = spawnSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--recurse-submodules"],
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
    .filter((filePath) => filePath.length > 0 && SOURCE_FILE_PATTERN.test(filePath));
};

const listSourceFilesViaFilesystem = (rootDirectory: string): string[] => {
  const filePaths: string[] = [];
  const stack = [rootDirectory];

  while (stack.length > 0) {
    const currentDirectory = stack.pop()!;
    const entries = fs.readdirSync(currentDirectory, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(currentDirectory, entry.name);

      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && !IGNORED_DIRECTORIES.has(entry.name)) {
          stack.push(absolutePath);
        }
        continue;
      }

      if (entry.isFile() && SOURCE_FILE_PATTERN.test(entry.name)) {
        filePaths.push(path.relative(rootDirectory, absolutePath).replace(/\\/g, "/"));
      }
    }
  }

  return filePaths;
};

const listSourceFiles = (rootDirectory: string): string[] =>
  listSourceFilesViaGit(rootDirectory) ?? listSourceFilesViaFilesystem(rootDirectory);

export const resolveLintIncludePaths = (
  rootDirectory: string,
  userConfig: ReactDoctorConfig | null,
): string[] | undefined => {
  if (!Array.isArray(userConfig?.ignore?.files) || userConfig.ignore.files.length === 0) {
    return undefined;
  }

  const ignoredPatterns = compileIgnoredFilePatterns(userConfig);

  const includedPaths = listSourceFiles(rootDirectory).filter((filePath) => {
    if (!JSX_FILE_PATTERN.test(filePath)) {
      return false;
    }

    return !isFileIgnoredByPatterns(filePath, rootDirectory, ignoredPatterns);
  });

  return includedPaths;
};
