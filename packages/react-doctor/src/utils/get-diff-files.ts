import { execSync } from "node:child_process";
import { DEFAULT_BRANCH_CANDIDATES, SOURCE_FILE_PATTERN } from "../constants.js";
import type { DiffInfo } from "../types.js";

const getCurrentBranch = (directory: string): string | null => {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: directory,
      stdio: "pipe",
    })
      .toString()
      .trim();
    return branch === "HEAD" ? null : branch;
  } catch {
    return null;
  }
};

const detectDefaultBranch = (directory: string): string | null => {
  try {
    const reference = execSync("git symbolic-ref refs/remotes/origin/HEAD", {
      cwd: directory,
      stdio: "pipe",
    })
      .toString()
      .trim();
    return reference.replace("refs/remotes/origin/", "");
  } catch {
    for (const candidate of DEFAULT_BRANCH_CANDIDATES) {
      try {
        execSync(`git rev-parse --verify ${candidate}`, {
          cwd: directory,
          stdio: "pipe",
        });
        return candidate;
      } catch {}
    }
    return null;
  }
};

const getChangedFilesSinceBranch = (directory: string, baseBranch: string): string[] => {
  try {
    const mergeBase = execSync(`git merge-base ${baseBranch} HEAD`, {
      cwd: directory,
      stdio: "pipe",
    })
      .toString()
      .trim();

    const output = execSync(`git diff --name-only --diff-filter=ACMR --relative ${mergeBase}`, {
      cwd: directory,
      stdio: "pipe",
    })
      .toString()
      .trim();

    if (!output) return [];
    return output.split("\n").filter(Boolean);
  } catch {
    return [];
  }
};

const getUncommittedChangedFiles = (directory: string): string[] => {
  try {
    const output = execSync("git diff --name-only --diff-filter=ACMR --relative HEAD", {
      cwd: directory,
      stdio: "pipe",
    })
      .toString()
      .trim();
    if (!output) return [];
    return output.split("\n").filter(Boolean);
  } catch {
    return [];
  }
};

export const getDiffInfo = (directory: string, explicitBaseBranch?: string): DiffInfo | null => {
  const currentBranch = getCurrentBranch(directory);
  if (!currentBranch) return null;

  const baseBranch = explicitBaseBranch ?? detectDefaultBranch(directory);
  if (!baseBranch) return null;

  if (currentBranch === baseBranch) {
    const uncommittedFiles = getUncommittedChangedFiles(directory);
    if (uncommittedFiles.length === 0) return null;
    return { currentBranch, baseBranch, changedFiles: uncommittedFiles, isCurrentChanges: true };
  }

  const changedFiles = getChangedFilesSinceBranch(directory, baseBranch);
  return { currentBranch, baseBranch, changedFiles };
};

export const filterSourceFiles = (filePaths: string[]): string[] =>
  filePaths.filter((filePath) => SOURCE_FILE_PATTERN.test(filePath));
