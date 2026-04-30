import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { GIT_LS_FILES_MAX_BUFFER_BYTES, SOURCE_FILE_PATTERN } from "../constants.js";

const findFilesWithDisableDirectives = (
  rootDirectory: string,
  includePaths?: string[],
): string[] => {
  const grepArgs = ["grep", "-l", "--untracked", "-E", "(eslint|oxlint)-disable"];
  if (includePaths && includePaths.length > 0) {
    grepArgs.push("--", ...includePaths);
  }

  const result = spawnSync("git", grepArgs, {
    cwd: rootDirectory,
    encoding: "utf-8",
    maxBuffer: GIT_LS_FILES_MAX_BUFFER_BYTES,
  });

  if (result.error || result.status === null) return [];
  if (result.status !== 0 && result.stdout.trim().length === 0) return [];

  return result.stdout
    .split("\n")
    .filter((filePath) => filePath.length > 0 && SOURCE_FILE_PATTERN.test(filePath));
};

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
