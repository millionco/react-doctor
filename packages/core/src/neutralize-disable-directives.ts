import * as Effect from "effect/Effect";
import * as fs from "node:fs";
import * as path from "node:path";
import { DISABLE_DIRECTIVE_BACKUP_DIRECTORY_SEGMENTS } from "./constants.js";
import { hasIgnoredPathSegment } from "./utils/has-ignored-path-segment.js";
import { isPathInsideDirectory } from "./utils/is-path-inside-directory.js";
import { isLintableSourceFile } from "./utils/is-lintable-source-file.js";
import { messageFromUnknown } from "./utils/message-from-unknown.js";
import { walkSourceTreeFiles } from "./utils/walk-source-tree-files.js";
import { Git } from "./services/git.js";

const DISABLE_DIRECTIVE_PATTERN = /(eslint|oxlint)-disable/;

const getBackupRootDirectory = (rootDirectory: string): string =>
  path.join(rootDirectory, ...DISABLE_DIRECTIVE_BACKUP_DIRECTORY_SEGMENTS);

const getBackupPath = (rootDirectory: string, absolutePath: string): string | null => {
  if (!isPathInsideDirectory(absolutePath, rootDirectory)) return null;
  return path.join(
    getBackupRootDirectory(rootDirectory),
    path.relative(rootDirectory, absolutePath),
  );
};

const removeBackupRootIfEmpty = (rootDirectory: string): void => {
  const backupRootDirectory = getBackupRootDirectory(rootDirectory);
  if (!walkSourceTreeFiles(backupRootDirectory).next().done) return;
  fs.rmSync(backupRootDirectory, { recursive: true, force: true });
};

interface NeutralizedFileLease {
  backupPath: string;
  originalContent: string;
  neutralizedContent: string;
  referenceCount: number;
}

const neutralizedFileLeases = new Map<string, NeutralizedFileLease>();

interface NeutralizationInitialization {
  readonly rootDirectory: string;
  readonly done: Promise<void>;
}

const activeNeutralizationInitializations = new Set<NeutralizationInitialization>();

const directoriesOverlap = (left: string, right: string): boolean => {
  const isWithin = (parent: string, candidate: string): boolean => {
    const relativePath = path.relative(parent, candidate);
    return (
      relativePath.length === 0 ||
      (!relativePath.startsWith(`..${path.sep}`) &&
        relativePath !== ".." &&
        !path.isAbsolute(relativePath))
    );
  };
  return isWithin(left, right) || isWithin(right, left);
};

const withOverlappingInitializationLock = async <Value>(
  rootDirectory: string,
  operation: () => Promise<Value>,
): Promise<Value> => {
  const blockers = [...activeNeutralizationInitializations]
    .filter((initialization) => directoriesOverlap(initialization.rootDirectory, rootDirectory))
    .map((initialization) => initialization.done);
  let release!: () => void;
  const done = new Promise<void>((resolve) => {
    release = resolve;
  });
  const initialization = { rootDirectory, done };
  // Register before waiting so a third overlapping scan queues behind both
  // this call and the initialization that this call is waiting for.
  activeNeutralizationInitializations.add(initialization);
  await Promise.all(blockers);
  try {
    return await operation();
  } finally {
    activeNeutralizationInitializations.delete(initialization);
    release();
  }
};

const findFilesWithDisableDirectivesViaGit = async (
  rootDirectory: string,
  includePaths?: string[],
): Promise<string[] | null> => {
  const program = Effect.gen(function* () {
    const git = yield* Git;
    return yield* git.grep({
      directory: rootDirectory,
      pattern: "(eslint|oxlint)-disable",
      extendedRegexp: true,
      listMatchingFiles: true,
      includeUntracked: true,
      includePaths: includePaths && includePaths.length > 0 ? includePaths : undefined,
    });
  });

  let grepResult: { readonly status: number; readonly stdout: string } | null;
  try {
    grepResult = await Effect.runPromise(program.pipe(Effect.provide(Git.layerNode)));
  } catch {
    return null;
  }
  if (grepResult === null) return null;

  return grepResult.stdout
    .split("\n")
    .filter(
      (filePath) =>
        filePath.length > 0 && isLintableSourceFile(filePath) && !hasIgnoredPathSegment(filePath),
    );
};

// HACK: filesystem fallback for non-git projects (and for cases where
// git grep refuses to run, e.g., uninitialized worktrees). Walks the
// scope, reads each source file, returns the relative paths that
// contain any `(eslint|oxlint)-disable` substring. Only walks the
// paths in `includePaths` when provided, otherwise the whole tree.
const findFilesWithDisableDirectivesViaFilesystem = (
  rootDirectory: string,
  includePaths?: string[],
): string[] => {
  const matches: string[] = [];
  const checkFile = (relativePath: string): void => {
    // Same exclusions as the git path above, so which discovery ran (and
    // whether `includePaths` carried a build-output path) never changes
    // which files get neutralized.
    if (!isLintableSourceFile(relativePath) || hasIgnoredPathSegment(relativePath)) return;
    const absolutePath = path.join(rootDirectory, relativePath);
    let content: string;
    try {
      content = fs.readFileSync(absolutePath, "utf-8");
    } catch {
      return;
    }
    if (DISABLE_DIRECTIVE_PATTERN.test(content)) matches.push(relativePath);
  };

  if (includePaths && includePaths.length > 0) {
    for (const candidate of includePaths) checkFile(candidate);
    return matches;
  }

  for (const { absolutePath } of walkSourceTreeFiles(rootDirectory)) {
    checkFile(path.relative(rootDirectory, absolutePath));
  }
  return matches;
};

const findFilesWithDisableDirectives = async (
  rootDirectory: string,
  includePaths?: string[],
): Promise<string[]> =>
  (await findFilesWithDisableDirectivesViaGit(rootDirectory, includePaths)) ??
  findFilesWithDisableDirectivesViaFilesystem(rootDirectory, includePaths);

interface NeutralizationOptions {
  /** Test seam for deterministically exercising asynchronous discovery races. */
  readonly findFiles?: (rootDirectory: string, includePaths?: string[]) => Promise<string[]>;
  readonly recoverOnly?: boolean;
}

const neutralizeContent = (content: string): string =>
  content
    .replaceAll("eslint-disable", "eslint_disable")
    .replaceAll("oxlint-disable", "oxlint_disable");

const collectNeutralizationCandidatePaths = (
  rootDirectory: string,
  discoveredRelativePaths: ReadonlyArray<string>,
  includePaths?: ReadonlyArray<string>,
): ReadonlySet<string> => {
  const resolvedRootDirectory = fs.realpathSync(rootDirectory);
  const requestedPaths =
    includePaths && includePaths.length > 0
      ? new Set(
          includePaths.flatMap((includePath) => {
            try {
              return [fs.realpathSync(path.resolve(resolvedRootDirectory, includePath))];
            } catch {
              return [];
            }
          }),
        )
      : null;
  const candidatePaths = new Set<string>();

  for (const relativePath of discoveredRelativePaths) {
    try {
      candidatePaths.add(fs.realpathSync(path.resolve(resolvedRootDirectory, relativePath)));
    } catch {
      continue;
    }
  }

  for (const leasedPath of neutralizedFileLeases.keys()) {
    const relativePath = path.relative(resolvedRootDirectory, leasedPath);
    const isInsideRoot =
      relativePath.length === 0 ||
      (!relativePath.startsWith(`..${path.sep}`) &&
        relativePath !== ".." &&
        !path.isAbsolute(relativePath));
    if (!isInsideRoot || (requestedPaths && !requestedPaths.has(leasedPath))) continue;
    candidatePaths.add(leasedPath);
  }

  return candidatePaths;
};

const recoverOrphanedBackups = (rootDirectory: string): Set<string> => {
  const blockedPaths = new Set<string>();
  const backupRootDirectory = getBackupRootDirectory(rootDirectory);
  for (const { absolutePath: backupPath } of walkSourceTreeFiles(backupRootDirectory)) {
    const originalPath = path.join(rootDirectory, path.relative(backupRootDirectory, backupPath));
    if (neutralizedFileLeases.has(originalPath)) continue;
    let backupContent: string;
    let currentContent: string;
    try {
      backupContent = fs.readFileSync(backupPath, "utf-8");
      currentContent = fs.readFileSync(originalPath, "utf-8");
    } catch (error) {
      process.stderr.write(
        `[react-doctor] Could not recover ${originalPath}: ${messageFromUnknown(error)}. The backup remains at ${backupPath}.\n`,
      );
      blockedPaths.add(originalPath);
      continue;
    }

    if (currentContent === backupContent) {
      try {
        fs.rmSync(backupPath);
      } catch (error) {
        process.stderr.write(
          `[react-doctor] Failed to delete stale backup ${backupPath}: ${messageFromUnknown(error)}\n`,
        );
        blockedPaths.add(originalPath);
      }
      continue;
    }

    if (currentContent !== neutralizeContent(backupContent)) {
      process.stderr.write(
        `[react-doctor] Did not overwrite changed file ${originalPath}. Recover it manually from ${backupPath}.\n`,
      );
      blockedPaths.add(originalPath);
      continue;
    }

    try {
      fs.writeFileSync(originalPath, backupContent);
      fs.rmSync(backupPath);
    } catch (error) {
      process.stderr.write(
        `[react-doctor] Failed to restore ${originalPath} from backup: ${messageFromUnknown(error)}\n`,
      );
      blockedPaths.add(originalPath);
    }
  }
  removeBackupRootIfEmpty(rootDirectory);
  return blockedPaths;
};

export const neutralizeDisableDirectives = async (
  rootDirectory: string,
  includePaths?: string[],
  options: NeutralizationOptions = {},
): Promise<() => void> => {
  const resolvedRootDirectory = fs.realpathSync(rootDirectory);
  const blockedPaths = new Set<string>();
  const leasedPaths = new Set<string>();

  let isRestored = false;
  const restore = () => {
    if (isRestored) return;
    isRestored = true;
    for (const absolutePath of leasedPaths) {
      const lease = neutralizedFileLeases.get(absolutePath);
      if (!lease) continue;
      lease.referenceCount -= 1;
      if (lease.referenceCount > 0) continue;
      // This lease no longer represents an active neutralization even when
      // the write fails. Keeping a zero-reference entry would let a later
      // scan adopt stale original content and overwrite a newer file.
      neutralizedFileLeases.delete(absolutePath);
      try {
        const currentContent = fs.readFileSync(absolutePath, "utf-8");
        if (
          currentContent !== lease.neutralizedContent &&
          currentContent !== lease.originalContent
        ) {
          process.stderr.write(
            `[react-doctor] Did not overwrite changed file ${absolutePath}. Recover it manually from ${lease.backupPath}.\n`,
          );
          continue;
        }
        if (currentContent === lease.neutralizedContent) {
          fs.writeFileSync(absolutePath, lease.originalContent);
        }
        fs.rmSync(lease.backupPath, { force: true });
      } catch (error) {
        process.stderr.write(
          `[react-doctor] Failed to restore inline disable directives in ${absolutePath}: ${messageFromUnknown(error)}. The backup remains at ${lease.backupPath}.\n`,
        );
      }
    }
    removeBackupRootIfEmpty(resolvedRootDirectory);
  };

  // HACK: register an "exit" listener so that any path that goes through
  // `process.exit(N)` (including the SIGINT path in cli.ts which calls
  // process.exit(130)) triggers restoration synchronously before termination.
  // We deliberately do NOT register an `uncaughtException` handler — that
  // would suppress Node's default crash behavior and leave the process hung
  // with no diagnostics. We also don't re-register the canonical SIGINT
  // pattern here; cli.ts owns it and routes through process.exit, which
  // covers us via the exit event.
  const onExit = () => restore();
  process.once("exit", onExit);

  const leaseCandidatePath = (absolutePath: string): void => {
    if (leasedPaths.has(absolutePath)) return;
    if (blockedPaths.has(absolutePath)) return;
    const existingLease = neutralizedFileLeases.get(absolutePath);
    if (existingLease) {
      existingLease.referenceCount += 1;
      leasedPaths.add(absolutePath);
      return;
    }

    let originalContent: string;
    try {
      originalContent = fs.readFileSync(absolutePath, "utf-8");
    } catch {
      return;
    }

    const neutralizedContent = neutralizeContent(originalContent);
    if (neutralizedContent !== originalContent) {
      const backupPath = getBackupPath(resolvedRootDirectory, absolutePath);
      if (backupPath === null) return;
      try {
        fs.mkdirSync(path.dirname(backupPath), { recursive: true });
        fs.writeFileSync(backupPath, originalContent, { flag: "wx" });
      } catch (error) {
        process.stderr.write(
          `[react-doctor] Did not modify ${absolutePath}: ${messageFromUnknown(error)}. Check ${backupPath}.\n`,
        );
        return;
      }
      fs.writeFileSync(absolutePath, neutralizedContent);
      neutralizedFileLeases.set(absolutePath, {
        backupPath,
        originalContent,
        neutralizedContent,
        referenceCount: 1,
      });
      leasedPaths.add(absolutePath);
    }
  };

  try {
    await withOverlappingInitializationLock(resolvedRootDirectory, async () => {
      for (const blockedPath of recoverOrphanedBackups(resolvedRootDirectory)) {
        blockedPaths.add(blockedPath);
      }
      if (options.recoverOnly) return;
      // Adopt active leases before the asynchronous discovery. This prevents
      // their owners from restoring the files while git grep is observing the
      // neutralized spellings. The overlap lock also prevents a newer nested
      // scan from neutralizing and fully restoring a file while this discovery
      // is still in flight.
      for (const absolutePath of collectNeutralizationCandidatePaths(
        resolvedRootDirectory,
        [],
        includePaths,
      )) {
        if (neutralizedFileLeases.has(absolutePath)) leaseCandidatePath(absolutePath);
      }

      const discoveredRelativePaths = await (options.findFiles ?? findFilesWithDisableDirectives)(
        resolvedRootDirectory,
        includePaths,
      );
      for (const absolutePath of collectNeutralizationCandidatePaths(
        resolvedRootDirectory,
        discoveredRelativePaths,
        includePaths,
      )) {
        leaseCandidatePath(absolutePath);
      }
    });
  } catch (error) {
    restore();
    process.removeListener("exit", onExit);
    throw error;
  }

  return () => {
    restore();
    process.removeListener("exit", onExit);
  };
};
