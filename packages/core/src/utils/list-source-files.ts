import { execFile, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { SourceFileEntry } from "../types/index.js";
import { COOPERATIVE_YIELD_BUDGET_MS, GIT_LS_FILES_MAX_BUFFER_BYTES } from "../constants.js";
import {
  collectGitLinguistIgnoredPaths,
  collectGitLinguistIgnoredPathsCooperative,
} from "./collect-git-linguist-ignored-paths.js";
import { collectTypeScriptEmitDuplicateJsPaths } from "./collect-typescript-emit-duplicate-js-paths.js";
import { hasIgnoredPathSegment } from "./has-ignored-path-segment.js";
import { isLintableSourceFile } from "./is-lintable-source-file.js";
import { isLargeMinifiedFile, statSourceFileSize } from "./is-large-minified-file.js";
import { walkSourceTreeFiles } from "./walk-source-tree-files.js";
import { yieldToEventLoop } from "./yield-to-event-loop.js";

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

const collectSizedSourceFilesCooperative = async (
  rootDirectory: string,
  relativePaths: ReadonlyArray<string>,
  signal?: AbortSignal,
): Promise<SourceFileEntry[]> => {
  const entries: SourceFileEntry[] = [];
  let sliceStartedAt = performance.now();
  for (const relativePath of relativePaths) {
    signal?.throwIfAborted();
    const absolutePath = path.resolve(rootDirectory, relativePath);
    const sizeBytes = statSourceFileSize(absolutePath);
    if (!isLargeMinifiedFile(absolutePath, sizeBytes)) {
      entries.push({ path: relativePath, sizeBytes: sizeBytes ?? 0 });
    }
    if (performance.now() - sliceStartedAt >= COOPERATIVE_YIELD_BUDGET_MS) {
      await yieldToEventLoop();
      sliceStartedAt = performance.now();
    }
  }
  return entries;
};

interface GitSourceFilePaths {
  readonly trackedPaths: string[];
  readonly untrackedPaths: string[];
}

const parseGitSourceFilePaths = (output: string): GitSourceFilePaths => {
  const trackedPaths = new Set<string>();
  const untrackedPaths: string[] = [];
  for (const entry of output.split("\0")) {
    if (entry.length === 0) continue;
    const trackedPath = /^[0-7]{6} [0-9a-f]+ [0-3]\t([\s\S]+)$/.exec(entry)?.[1];
    if (trackedPath === undefined) {
      untrackedPaths.push(entry);
    } else {
      trackedPaths.add(trackedPath);
    }
  }
  return { trackedPaths: [...trackedPaths], untrackedPaths };
};

const listGitSourceFilePaths = (rootDirectory: string): GitSourceFilePaths | null => {
  const result = spawnSync("git", ["ls-files", "-z", "--stage", "--others", "--exclude-standard"], {
    cwd: rootDirectory,
    encoding: "utf-8",
    maxBuffer: GIT_LS_FILES_MAX_BUFFER_BYTES,
  });
  if (result.error || result.status !== 0) {
    return null;
  }
  return parseGitSourceFilePaths(result.stdout);
};

const collectGitCandidateSourceFilePaths = (
  rootDirectory: string,
  paths: GitSourceFilePaths,
): string[] => {
  const { trackedPaths, untrackedPaths } = paths;
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

const filterGitSourceFilePaths = (rootDirectory: string, paths: GitSourceFilePaths): string[] => {
  const candidatePaths = collectGitCandidateSourceFilePaths(rootDirectory, paths);
  const linguistIgnoredPaths = collectGitLinguistIgnoredPaths(rootDirectory, candidatePaths);
  return candidatePaths.filter((filePath) => !linguistIgnoredPaths.has(filePath));
};

const listSourceFilesViaGit = (rootDirectory: string): string[] | null => {
  const paths = listGitSourceFilePaths(rootDirectory);
  return paths === null ? null : filterGitSourceFilePaths(rootDirectory, paths);
};

const listSourceFilesViaGitCooperative = async (
  rootDirectory: string,
  signal?: AbortSignal,
): Promise<string[] | null> => {
  const paths = await new Promise<GitSourceFilePaths | null>((resolve, reject) => {
    signal?.throwIfAborted();
    execFile(
      "git",
      ["ls-files", "-z", "--stage", "--others", "--exclude-standard"],
      {
        cwd: rootDirectory,
        encoding: "utf-8",
        killSignal: "SIGKILL",
        maxBuffer: GIT_LS_FILES_MAX_BUFFER_BYTES,
        signal,
      },
      (error, stdout) => {
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        resolve(error ? null : parseGitSourceFilePaths(stdout));
      },
    );
  });
  if (paths === null) return null;
  const candidatePaths = collectGitCandidateSourceFilePaths(rootDirectory, paths);
  const linguistIgnoredPaths = await collectGitLinguistIgnoredPathsCooperative(
    rootDirectory,
    candidatePaths,
    signal,
  );
  return candidatePaths.filter((filePath) => !linguistIgnoredPaths.has(filePath));
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

const listSourceFilesViaFilesystemCooperative = async (
  rootDirectory: string,
  signal?: AbortSignal,
): Promise<string[]> => {
  const filePaths: string[] = [];
  let sliceStartedAt = performance.now();
  for (const { absolutePath, name } of walkSourceTreeFiles(rootDirectory)) {
    signal?.throwIfAborted();
    if (isLintableSourceFile(name)) {
      filePaths.push(path.relative(rootDirectory, absolutePath).replace(/\\/g, "/"));
    }
    if (performance.now() - sliceStartedAt >= COOPERATIVE_YIELD_BUDGET_MS) {
      await yieldToEventLoop();
      sliceStartedAt = performance.now();
    }
  }
  return filePaths;
};

const listSourceFilePaths = (rootDirectory: string): string[] =>
  (listSourceFilesViaGit(rootDirectory) ?? listSourceFilesViaFilesystem(rootDirectory)).sort();

const listSourceFilePathsCooperative = async (
  rootDirectory: string,
  signal?: AbortSignal,
): Promise<string[]> =>
  (
    (await listSourceFilesViaGitCooperative(rootDirectory, signal)) ??
    (await listSourceFilesViaFilesystemCooperative(rootDirectory, signal))
  ).sort();

// Returns every source file under `rootDirectory` paired with its byte size
// (relative paths, forward-slash separators). Prefers a single `git ls-files`
// call when the directory is a git repository — much faster than the fallback
// filesystem walk and respects `.gitignore` automatically. The size is the
// minified gate's existing stat, captured rather than discarded, so the lint
// pass can order batches largest-first at zero extra syscall cost.
export const listSourceFilesWithSize = (rootDirectory: string): ReadonlyArray<SourceFileEntry> =>
  collectSizedSourceFiles(rootDirectory, listSourceFilePaths(rootDirectory));

export const listSourceFilesWithSizeCooperative = async (
  rootDirectory: string,
  signal?: AbortSignal,
): Promise<SourceFileEntry[]> =>
  collectSizedSourceFilesCooperative(
    rootDirectory,
    await listSourceFilePathsCooperative(rootDirectory, signal),
    signal,
  );

export const listSourceFilesCooperative = async (
  rootDirectory: string,
  signal?: AbortSignal,
): Promise<string[]> =>
  (await listSourceFilesWithSizeCooperative(rootDirectory, signal)).map((entry) => entry.path);

// Returns every source file under `rootDirectory` (relative paths,
// forward-slash separators). The size-free view of `listSourceFilesWithSize`
// for the many callers that only want the path list.
export const listSourceFiles = (rootDirectory: string): string[] =>
  listSourceFilesWithSize(rootDirectory).map((entry) => entry.path);
