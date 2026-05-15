import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  GIT_LS_FILES_MAX_BUFFER_BYTES,
  IGNORED_DIRECTORIES,
  SOURCE_FILE_PATTERN,
} from "../constants.js";

const DISABLE_DIRECTIVE_PATTERN = /(eslint|oxlint)-disable/;

const findFilesWithDisableDirectivesViaGit = (
  rootDirectory: string,
  includePaths?: string[],
): string[] | null => {
  const grepArgs = ["grep", "-l", "--untracked", "-E", "(eslint|oxlint)-disable"];
  if (includePaths && includePaths.length > 0) {
    grepArgs.push("--", ...includePaths);
  }

  const result = spawnSync("git", grepArgs, {
    cwd: rootDirectory,
    encoding: "utf-8",
    maxBuffer: GIT_LS_FILES_MAX_BUFFER_BYTES,
  });

  // null status means git wasn't found at all; non-null+nonzero with no
  // output means "ran but no matches" only when there's no error code.
  // Distinguish "git unavailable / not a repo" (return null → caller
  // falls back) from "git ran successfully" (return [] or matches).
  if (result.error || result.status === null) return null;
  // Status 1 with empty stdout = git grep ran inside a repo and found
  // nothing. Status 128 = "not a git repo". Treat 128 as fallback.
  if (result.status === 128) return null;

  return result.stdout
    .split("\n")
    .filter((filePath) => filePath.length > 0 && SOURCE_FILE_PATTERN.test(filePath));
};

// HACK: filesystem fallback for non-git projects (and for cases where
// git grep refuses to run, e.g., uninitialized worktrees). Walks the
// scope, reads each source file, returns the relative paths that
// contain any `(eslint|oxlint)-disable` substring. Only walks the
// paths in `includePaths` when provided, otherwise the whole tree.
const findFilesWithDisableDirectivesViaFilesystem = (
  rootDirectory: string,
  includePaths?: string[],
): string[] => {
  const matches: string[] = [];
  const checkFile = (relativePath: string): void => {
    if (!SOURCE_FILE_PATTERN.test(relativePath)) return;
    const absolutePath = path.join(rootDirectory, relativePath);
    let content: string;
    try {
      content = fs.readFileSync(absolutePath, "utf-8");
    } catch {
      return;
    }
    if (DISABLE_DIRECTIVE_PATTERN.test(content)) matches.push(relativePath);
  };

  if (includePaths && includePaths.length > 0) {
    for (const candidate of includePaths) checkFile(candidate);
    return matches;
  }

  const stack = [rootDirectory];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || IGNORED_DIRECTORIES.has(entry.name)) continue;
        stack.push(path.join(current, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const absolute = path.join(current, entry.name);
      const relative = path.relative(rootDirectory, absolute);
      checkFile(relative);
    }
  }
  return matches;
};

const findFilesWithDisableDirectives = (rootDirectory: string, includePaths?: string[]): string[] =>
  findFilesWithDisableDirectivesViaGit(rootDirectory, includePaths) ??
  findFilesWithDisableDirectivesViaFilesystem(rootDirectory, includePaths);

const neutralizeContent = (content: string): string =>
  content
    .replaceAll("eslint-disable", "eslint_disable")
    .replaceAll("oxlint-disable", "oxlint_disable");

export const neutralizeDisableDirectives = (
  rootDirectory: string,
  includePaths?: string[],
): (() => void) => {
  const filePaths = findFilesWithDisableDirectives(rootDirectory, includePaths);
  const originalContents = new Map<string, string>();

  let isRestored = false;
  const restore = () => {
    if (isRestored) return;
    isRestored = true;
    for (const [absolutePath, originalContent] of originalContents) {
      try {
        fs.writeFileSync(absolutePath, originalContent);
      } catch {
        // Best-effort restore; surface manually if it fails.
      }
    }
  };

  // HACK: register an "exit" listener so that any path that goes through
  // `process.exit(N)` (including the SIGINT path in cli.ts which calls
  // process.exit(130)) triggers restoration synchronously before termination.
  // We deliberately do NOT register an `uncaughtException` handler — that
  // would suppress Node's default crash behavior and leave the process hung
  // with no diagnostics. We also don't re-register the canonical SIGINT
  // pattern here; cli.ts owns it and routes through process.exit, which
  // covers us via the exit event.
  const onExit = () => restore();
  process.once("exit", onExit);

  for (const relativePath of filePaths) {
    const absolutePath = path.join(rootDirectory, relativePath);

    let originalContent: string;
    try {
      originalContent = fs.readFileSync(absolutePath, "utf-8");
    } catch {
      continue;
    }

    const neutralizedContent = neutralizeContent(originalContent);
    if (neutralizedContent !== originalContent) {
      originalContents.set(absolutePath, originalContent);
      fs.writeFileSync(absolutePath, neutralizedContent);
    }
  }

  return () => {
    restore();
    process.removeListener("exit", onExit);
  };
};
