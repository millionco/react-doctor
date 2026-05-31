import { spawnSync } from "node:child_process";
import path from "node:path";
import { readDirectoryEntries } from "../project-info/index.js";
import { GIT_LS_FILES_MAX_BUFFER_BYTES, IGNORED_DIRECTORIES } from "../constants.js";
import { isLintableSourceFile } from "./is-lintable-source-file.js";
import { isLargeMinifiedFile } from "./is-large-minified-file.js";

// Drops minified / generated files that slipped past the extension gate
// (e.g. a one-line `public/inject.js` bundle). Shares its predicate with
// `countSourceFiles` so the scanned set and the reported source-file count
// stay in lockstep.
const excludeMinifiedFiles = (rootDirectory: string, relativePaths: string[]): string[] =>
  relativePaths.filter(
    (relativePath) => !isLargeMinifiedFile(path.resolve(rootDirectory, relativePath)),
  );

const listSourceFilesViaGit = (rootDirectory: string): string[] | null => {
  // HACK: --recurse-submodules is incompatible with --others /
  // --exclude-standard (git rejects the combination). Without this
  // match, every git-mode call silently exited non-zero and the scan
  // always fell back to the much slower filesystem walk below, also
  // skipping submodule files entirely.
  const result = spawnSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      cwd: rootDirectory,
      encoding: "utf-8",
      maxBuffer: GIT_LS_FILES_MAX_BUFFER_BYTES,
    },
  );

  if (result.error || result.status !== 0) {
    return null;
  }

  return result.stdout
    .split("\0")
    .filter((filePath) => filePath.length > 0 && isLintableSourceFile(filePath));
};

const listSourceFilesViaFilesystem = (rootDirectory: string): string[] => {
  const filePaths: string[] = [];
  const stack = [rootDirectory];

  while (stack.length > 0) {
    const currentDirectory = stack.pop()!;
    const entries = readDirectoryEntries(currentDirectory);

    for (const entry of entries) {
      const absolutePath = path.join(currentDirectory, entry.name);

      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && !IGNORED_DIRECTORIES.has(entry.name)) {
          stack.push(absolutePath);
        }
        continue;
      }

      if (entry.isFile() && isLintableSourceFile(entry.name)) {
        filePaths.push(path.relative(rootDirectory, absolutePath).replace(/\\/g, "/"));
      }
    }
  }

  return filePaths;
};

// Returns every source file under `rootDirectory` (relative paths,
// forward-slash separators). Prefers a single `git ls-files` call when
// the directory is a git repository — much faster than the fallback
// filesystem walk and respects `.gitignore` automatically.
export const listSourceFiles = (rootDirectory: string): string[] =>
  excludeMinifiedFiles(
    rootDirectory,
    listSourceFilesViaGit(rootDirectory) ?? listSourceFilesViaFilesystem(rootDirectory),
  );
