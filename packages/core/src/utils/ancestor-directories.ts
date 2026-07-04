import * as path from "node:path";

/**
 * The chain of ancestor directories of `startDirectory`, nearest first, up to
 * and including the filesystem root. With `includeStart`, the chain begins at
 * `startDirectory` itself; otherwise at its parent. The one place the "walk up
 * the tree" traversal is expressed, so each caller adds only its own match /
 * stop policy instead of re-deriving the `path.dirname` loop.
 */
export const ancestorDirectories = (
  startDirectory: string,
  { includeStart }: { includeStart: boolean },
): string[] => {
  const directories: string[] = [];
  let currentDirectory = includeStart ? startDirectory : path.dirname(startDirectory);

  while (true) {
    directories.push(currentDirectory);
    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) return directories;
    currentDirectory = parentDirectory;
  }
};
