import * as Effect from "effect/Effect";
import * as fs from "node:fs";
import * as path from "node:path";
import { hasIgnoredPathSegment } from "./utils/has-ignored-path-segment.js";
import { isLintableSourceFile } from "./utils/is-lintable-source-file.js";
import { messageFromUnknown } from "./utils/message-from-unknown.js";
import { walkSourceTreeFiles } from "./utils/walk-source-tree-files.js";
import { Git } from "./services/git.js";

const DISABLE_DIRECTIVE_PATTERN = /(eslint|oxlint)-disable/;

interface NeutralizedFileLease {
  originalContent: string;
  referenceCount: number;
}

const neutralizedFileLeases = new Map<string, NeutralizedFileLease>();

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
  const requestedPaths = includePaths && includePaths.length > 0
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

export const neutralizeDisableDirectives = async (
  rootDirectory: string,
  includePaths?: string[],
): Promise<() => void> => {
  const discoveredRelativePaths = await findFilesWithDisableDirectives(rootDirectory, includePaths);
  const candidatePaths = collectNeutralizationCandidatePaths(
    rootDirectory,
    discoveredRelativePaths,
    includePaths,
  );
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
      try {
        fs.writeFileSync(absolutePath, lease.originalContent);
        neutralizedFileLeases.delete(absolutePath);
      } catch (error) {
        // HACK: surface failed restores so the user can manually revert.
        // Silently swallowing left source files with `eslint_disable` /
        // `oxlint_disable` (neutralized form) and no signal anything broke.
        process.stderr.write(
          `[react-doctor] Failed to restore inline disable directives in ${absolutePath}: ${messageFromUnknown(error)}\n` +
            `[react-doctor] Run: git checkout -- ${absolutePath}\n`,
        );
      }
    }
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

  for (const absolutePath of candidatePaths) {
    const existingLease = neutralizedFileLeases.get(absolutePath);
    if (existingLease) {
      existingLease.referenceCount += 1;
      leasedPaths.add(absolutePath);
      continue;
    }

    let originalContent: string;
    try {
      originalContent = fs.readFileSync(absolutePath, "utf-8");
    } catch {
      continue;
    }

    const neutralizedContent = neutralizeContent(originalContent);
    if (neutralizedContent !== originalContent) {
      fs.writeFileSync(absolutePath, neutralizedContent);
      neutralizedFileLeases.set(absolutePath, { originalContent, referenceCount: 1 });
      leasedPaths.add(absolutePath);
    }
  }

  return () => {
    restore();
    process.removeListener("exit", onExit);
  };
};
