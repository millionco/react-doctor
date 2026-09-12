import * as fs from "node:fs";
import * as path from "node:path";
import { HELP_OR_VERSION_FLAGS } from "./constants.js";

const isExistingDirectory = (absolutePath: string): boolean => {
  try {
    return fs.statSync(absolutePath).isDirectory();
  } catch {
    return false;
  }
};

// Guesses the directory the default scan command will resolve from raw argv,
// before commander parses it. A wrong guess only costs an unused git child:
// the prefetched output is keyed by the exact directory, so a scan of any
// other directory spawns its own commands as before. `null` means the
// invocation is not a plain scan (help, version, or a subcommand).
export const resolvePrefetchScanDirectory = (
  argv: ReadonlyArray<string>,
  currentDirectory: string,
): string | null => {
  const directoryCandidates: string[] = [];
  let previousToken: string | null = null;
  for (const token of argv) {
    if (HELP_OR_VERSION_FLAGS.has(token)) return null;
    const isFlag = token.startsWith("-");
    if (!isFlag) {
      if (isExistingDirectory(path.resolve(currentDirectory, token))) {
        directoryCandidates.push(token);
      } else if (previousToken === null || !previousToken.startsWith("-")) {
        return null;
      }
    }
    previousToken = token;
  }
  if (directoryCandidates.length > 1) return null;
  return path.resolve(currentDirectory, directoryCandidates[0] ?? ".");
};
