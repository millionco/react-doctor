import { spawnSync } from "node:child_process";
import { DEFAULT_BRANCH_CANDIDATES, SOURCE_FILE_PATTERN } from "../../constants.js";
import type { DiffInfo } from "../../types/inspect.js";

const runGit = (cwd: string, args: string[]): string | null => {
  const result = spawnSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf-8",
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout.toString().trim();
};

const getCurrentBranch = (directory: string): string | null => {
  const branch = runGit(directory, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branch) return null;
  return branch === "HEAD" ? null : branch;
};

const detectDefaultBranch = (directory: string): string | null => {
  const reference = runGit(directory, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
  if (reference) return reference.replace("refs/remotes/origin/", "");

  const candidateRefs = DEFAULT_BRANCH_CANDIDATES.map((candidate) => `refs/heads/${candidate}`);
  const output = runGit(directory, ["for-each-ref", "--format=%(refname:short)", ...candidateRefs]);
  if (output) {
    const firstLine = output.split("\n")[0]?.trim();
    if (firstLine) return firstLine;
  }
  return null;
};

const branchExists = (directory: string, branch: string): boolean => {
  const result = spawnSync("git", ["rev-parse", "--verify", branch], {
    cwd: directory,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return !result.error && result.status === 0;
};

const runGitNullSeparated = (cwd: string, args: string[]): string[] | null => {
  const result = spawnSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf-8",
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout
    .toString()
    .split("\0")
    .filter((filePath) => filePath.length > 0);
};

const getChangedFilesSinceBranch = (directory: string, baseBranch: string): string[] | null => {
  const mergeBase = runGit(directory, ["merge-base", baseBranch, "HEAD"]);
  if (mergeBase === null) return null;

  return runGitNullSeparated(directory, [
    "diff",
    "-z",
    "--name-only",
    "--diff-filter=ACMR",
    "--relative",
    mergeBase,
  ]);
};

const getUncommittedChangedFiles = (directory: string): string[] => {
  const output = runGitNullSeparated(directory, [
    "diff",
    "-z",
    "--name-only",
    "--diff-filter=ACMR",
    "--relative",
    "HEAD",
  ]);
  return output ?? [];
};

export const getDiffInfo = (directory: string, explicitBaseBranch?: string): DiffInfo | null => {
  if (explicitBaseBranch !== undefined && explicitBaseBranch.trim().length === 0) {
    throw new Error("Diff base branch cannot be empty.");
  }

  const currentBranch = getCurrentBranch(directory);
  if (!currentBranch) return null;

  const baseBranch = explicitBaseBranch ?? detectDefaultBranch(directory);
  if (!baseBranch) return null;

  if (explicitBaseBranch && !branchExists(directory, explicitBaseBranch)) {
    throw new Error(
      `Diff base branch "${explicitBaseBranch}" does not exist (run \`git fetch\` to update remote refs).`,
    );
  }

  if (currentBranch === baseBranch) {
    const uncommittedFiles = getUncommittedChangedFiles(directory);
    if (uncommittedFiles.length === 0) return null;
    return { currentBranch, baseBranch, changedFiles: uncommittedFiles, isCurrentChanges: true };
  }

  const changedFiles = getChangedFilesSinceBranch(directory, baseBranch);
  if (changedFiles === null) return null;
  return { currentBranch, baseBranch, changedFiles };
};

export const filterSourceFiles = (filePaths: string[]): string[] =>
  filePaths.filter((filePath) => SOURCE_FILE_PATTERN.test(filePath));
