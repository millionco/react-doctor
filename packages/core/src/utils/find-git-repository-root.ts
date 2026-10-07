import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Nearest ancestor (inclusive) that holds a `.git` entry — a directory for a
 * checkout, a file for worktrees and submodules. `null` outside any repository.
 */
export const findGitRepositoryRoot = (directory: string): string | null => {
  let currentDirectory = path.resolve(directory);
  while (true) {
    if (fs.existsSync(path.join(currentDirectory, ".git"))) return currentDirectory;
    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) return null;
    currentDirectory = parentDirectory;
  }
};
