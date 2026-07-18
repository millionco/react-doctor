import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { SourceFileEntry } from "../types/index.js";
import { GIT_LS_FILES_MAX_BUFFER_BYTES } from "../constants.js";
import { collectTypeScriptEmitDuplicateJsPaths } from "./collect-typescript-emit-duplicate-js-paths.js";
import { hasIgnoredPathSegment } from "./has-ignored-path-segment.js";
import { isLintableSourceFile } from "./is-lintable-source-file.js";
import { isLargeMinifiedFile, statSourceFileSize } from "./is-large-minified-file.js";
import { walkSourceTreeFiles } from "./walk-source-tree-files.js";

// Stats each candidate once (the same stat the minified gate already paid),
// drops files that sniff as large minified bundles, and keeps the size so the
// lint pass can order batches largest-first. `countSourceFiles` delegates to
// `listSourceFilesWithSize`, so the scanned set and the reported source-file
// count can never diverge. A file that can't be stat'd is KEPT (parity with
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

const gitLsFiles = (rootDirectory: string, flags: ReadonlyArray<string>): string[] | null => {
  const result = spawnSync("git", ["ls-files", "-z", ...flags], {
    cwd: rootDirectory,
    encoding: "utf-8",
    maxBuffer: GIT_LS_FILES_MAX_BUFFER_BYTES,
  });
  if (result.error || result.status !== 0) {
    return null;
  }
  return result.stdout.split("\0").filter((filePath) => filePath.length > 0);
};

const listSourceFilesViaGit = (rootDirectory: string): string[] | null => {
  // HACK: --recurse-submodules is incompatible with --others /
  // --exclude-standard (git rejects the combination). Without this
  // match, every git-mode call silently exited non-zero and the scan
  // always fell back to the much slower filesystem walk below, also
  // skipping submodule files entirely.
  const trackedPaths = gitLsFiles(rootDirectory, ["--cached"]);
  const untrackedPaths = gitLsFiles(rootDirectory, ["--others", "--exclude-standard"]);
  if (trackedPaths === null || untrackedPaths === null) {
    return null;
  }
  const emitDuplicateJsPaths = collectTypeScriptEmitDuplicateJsPaths({
    trackedPaths: new Set(trackedPaths),
    untrackedPaths,
    readFileText: (relativePath) =>
      fs.readFileSync(path.resolve(rootDirectory, relativePath), "utf-8"),
  });
  return [...trackedPaths, ...untrackedPaths].filter(
    (filePath) =>
      isLintableSourceFile(filePath) &&
      !hasIgnoredPathSegment(filePath) &&
      !emitDuplicateJsPaths.has(filePath),
  );
};

const listSourceFilesViaFilesystem = (rootDirectory: string): string[] => {
  const filePaths: string[] = [];
  for (const { absolutePath, name } of walkSourceTreeFiles(rootDirectory)) {
    if (isLintableSourceFile(name)) {
      filePaths.push(path.relative(rootDirectory, absolutePath).replace(/\\/g, "/"));
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
    // Sort whichever discovery path ran: the filesystem walk's readdir order is
    // OS-dependent, and `git ls-files` orders cached vs. untracked entries by
    // its own rules — sorting here makes both paths enumerate one identical,
    // repeatable order for the same tree.
    (listSourceFilesViaGit(rootDirectory) ?? listSourceFilesViaFilesystem(rootDirectory)).sort(),
  );

// Returns every source file under `rootDirectory` (relative paths,
// forward-slash separators). The size-free view of `listSourceFilesWithSize`
// for the many callers that only want the path list.
export const listSourceFiles = (rootDirectory: string): string[] =>
  listSourceFilesWithSize(rootDirectory).map((entry) => entry.path);
