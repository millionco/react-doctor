import { spawnSync } from "node:child_process";
import * as path from "node:path";
import type { SourceFileEntry } from "../types/index.js";
import { readDirectoryEntries } from "../project-info/index.js";
import { GIT_LS_FILES_MAX_BUFFER_BYTES, IGNORED_DIRECTORIES } from "../constants.js";
import { isLintableSourceFile } from "./is-lintable-source-file.js";
import { isLargeMinifiedFile, statSourceFileSize } from "./is-large-minified-file.js";

// Stats each candidate once (the same stat the minified gate already paid),
// drops files that sniff as large minified bundles, and keeps the size so the
// lint pass can order batches largest-first. Shares its predicate with
// `countSourceFiles` so the scanned set and the reported source-file count
// stay in lockstep. A file that can't be stat'd is KEPT (parity with
// `isLargeMinifiedFile`'s keep-on-error) with size `0`, so it sorts to the
// cheap tail.
const collectSizedSourceFiles = (
  rootDirectory: string,
  relativePaths: ReadonlyArray<string>,
): SourceFileEntry[] => {
  const entries: SourceFileEntry[] = [];
  for (const relativePath of relativePaths) {
    const absolutePath = path.resolve(rootDirectory, relativePath);
    const sizeBytes = statSourceFileSize(absolutePath);
    if (isLargeMinifiedFile(absolutePath, sizeBytes)) continue;
    entries.push({ path: relativePath, sizeBytes: sizeBytes ?? 0 });
  }
  return entries;
};

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

// Returns every source file under `rootDirectory` paired with its byte size
// (relative paths, forward-slash separators). Prefers a single `git ls-files`
// call when the directory is a git repository — much faster than the fallback
// filesystem walk and respects `.gitignore` automatically. The size is the
// minified gate's existing stat, captured rather than discarded, so the lint
// pass can order batches largest-first at zero extra syscall cost.
export const listSourceFilesWithSize = (rootDirectory: string): ReadonlyArray<SourceFileEntry> =>
  collectSizedSourceFiles(
    rootDirectory,
    listSourceFilesViaGit(rootDirectory) ?? listSourceFilesViaFilesystem(rootDirectory),
  );

// Returns every source file under `rootDirectory` (relative paths,
// forward-slash separators). The size-free view of `listSourceFilesWithSize`
// for the many callers that only want the path list.
export const listSourceFiles = (rootDirectory: string): string[] =>
  listSourceFilesWithSize(rootDirectory).map((entry) => entry.path);
