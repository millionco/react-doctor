import * as path from "node:path";
import { readDirectoryEntries } from "../project-info/fs-utils.js";
import { isIgnoredDirectoryName } from "./is-ignored-directory-name.js";

export interface WalkedSourceTreeFile {
  absolutePath: string;
  /** The file's base name (the last path segment). */
  name: string;
}

// THE whole-tree descent rule, shared so discovery paths can never disagree
// on which directories a scan covers: descend into every directory
// `isIgnoredDirectoryName` allows — always-ignored names and hidden
// dot-directories are skipped, except the `SCANNED_DOT_DIRECTORIES`
// allowlist (`.dumi`, `.storybook`), whose tracked sources `git ls-files`
// also lists — and yield every plain file. Consumers: `listSourceFiles`'
// filesystem fallback, the disable-directive walk, and the reduced-motion
// fallback. The security scan keeps its own walk (depth cap, its own skip
// set, priority buckets).
export function* walkSourceTreeFiles(
  rootDirectory: string,
): Generator<WalkedSourceTreeFile, void, void> {
  const stack = [rootDirectory];
  while (stack.length > 0) {
    const currentDirectory = stack.pop();
    if (currentDirectory === undefined) continue;
    for (const entry of readDirectoryEntries(currentDirectory)) {
      const absolutePath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        if (!isIgnoredDirectoryName(entry.name)) stack.push(absolutePath);
        continue;
      }
      if (entry.isFile()) yield { absolutePath, name: entry.name };
    }
  }
}
