import * as path from "node:path";
import { readDirectoryEntries } from "../project-info/utils/read-directory-entries.js";
import { IGNORED_DIRECTORIES } from "../constants.js";

export interface WalkedSourceTreeFile {
  absolutePath: string;
  /** The file's base name (the last path segment). */
  name: string;
}

// THE whole-tree descent rule, shared so discovery paths can never disagree
// on which directories a scan covers: descend into every directory not in
// `IGNORED_DIRECTORIES` — including dot-directories (`.dumi`, `.storybook`),
// whose tracked sources `git ls-files` also lists — and yield every plain
// file. Consumers: `listSourceFiles`' filesystem fallback, the
// disable-directive walk, and the reduced-motion fallback. The security scan
// keeps its own walk (depth cap, its own skip set, priority buckets).
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
        if (!IGNORED_DIRECTORIES.has(entry.name)) stack.push(absolutePath);
        continue;
      }
      if (entry.isFile()) yield { absolutePath, name: entry.name };
    }
  }
}
