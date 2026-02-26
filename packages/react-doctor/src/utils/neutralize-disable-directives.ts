import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { GIT_LS_FILES_MAX_BUFFER_BYTES, SOURCE_FILE_PATTERN } from "../constants.js";

const findFilesWithDisableDirectives = (rootDirectory: string): string[] => {
  const result = spawnSync("git", ["grep", "-l", "--untracked", "-E", "(eslint|oxlint)-disable"], {
    cwd: rootDirectory,
    encoding: "utf-8",
    maxBuffer: GIT_LS_FILES_MAX_BUFFER_BYTES,
  });

  if (result.error || result.status === null) return [];

  return result.stdout
    .split("\n")
    .filter((filePath) => filePath.length > 0 && SOURCE_FILE_PATTERN.test(filePath));
};

const neutralizeContent = (content: string): string =>
  content
    .replaceAll("eslint-disable", "eslint_disable")
    .replaceAll("oxlint-disable", "oxlint_disable");

export const neutralizeDisableDirectives = (rootDirectory: string): (() => void) => {
  const filePaths = findFilesWithDisableDirectives(rootDirectory);
  const originalContents = new Map<string, string>();

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
    for (const [absolutePath, originalContent] of originalContents) {
      fs.writeFileSync(absolutePath, originalContent);
    }
  };
};
