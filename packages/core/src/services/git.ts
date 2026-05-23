import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from "node:child_process";
import { DEFAULT_BRANCH_CANDIDATES, GIT_LS_FILES_MAX_BUFFER_BYTES } from "../constants.js";
import {
  GitBaseBranchInvalid,
  GitBaseBranchMissing,
  GitInvocationFailed,
  ReactDoctorError,
} from "../errors.js";

interface GitInvocationOptions {
  readonly maxBufferBytes?: number;
  readonly allowNonZeroExit?: boolean;
}

interface GitInvocationResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Internal Effect-typed git invocation. Wraps `spawnSync` so callers
 * stay synchronous (matches the existing react-doctor diff API). The
 * `Git` service exposes higher-level methods on top of this primitive
 * so call sites never touch `spawnSync` directly.
 */
const invokeGitSync = (
  directory: string,
  args: ReadonlyArray<string>,
  options: GitInvocationOptions = {},
): Effect.Effect<GitInvocationResult, ReactDoctorError> =>
  Effect.try({
    try: (): GitInvocationResult => {
      const spawnOptions: SpawnSyncOptionsWithStringEncoding = {
        cwd: directory,
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf-8",
        maxBuffer: options.maxBufferBytes ?? GIT_LS_FILES_MAX_BUFFER_BYTES,
      };
      const result = spawnSync("git", [...args], spawnOptions);
      if (result.error) throw result.error;
      return {
        status: result.status,
        stdout: result.stdout?.toString() ?? "",
        stderr: result.stderr?.toString() ?? "",
      };
    },
    catch: (cause) =>
      new ReactDoctorError({
        reason: new GitInvocationFailed({ args: [...args], directory, cause }),
      }),
  });

const trimOrNull = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

const splitNullSeparated = (value: string): ReadonlyArray<string> =>
  value.split("\0").filter((entry) => entry.length > 0);

export interface GitDiffSelection {
  /**
   * `null` when `HEAD` is detached (e.g. GitHub Actions
   * `pull_request` runs that check out `refs/pull/N/merge`).
   */
  readonly currentBranch: string | null;
  readonly baseBranch: string;
  readonly changedFiles: ReadonlyArray<string>;
  readonly isCurrentChanges: boolean;
}

interface GitDiffSelectionInput {
  readonly directory: string;
  readonly explicitBaseBranch?: string;
}

interface GitShowOptions {
  readonly maxBufferBytes?: number;
}

interface GitGrepInput {
  readonly directory: string;
  readonly pattern: string;
  readonly extendedRegexp?: boolean;
  readonly listMatchingFiles?: boolean;
  readonly includeUntracked?: boolean;
  readonly includePaths?: ReadonlyArray<string>;
  readonly maxBufferBytes?: number;
}

interface GitGrepResult {
  readonly status: number;
  readonly stdout: string;
}

/**
 * `Git` wraps every `git`-via-`spawnSync` call react-doctor makes
 * (current branch detection, diff-base resolution, `git diff`,
 * `git diff --cached`, `git grep`, `git show :<path>`) behind a
 * service interface so tests can swap in `layerOf({ ... })` snapshots
 * without spinning up a real repository, and so future async
 * conversion (via `ChildProcess` from `effect/unstable/process`) can
 * happen without disturbing call sites.
 *
 * All methods raise `ReactDoctorError` with a `GitInvocationFailed`
 * reason when `git` itself can't run; "git ran but produced no
 * matches" still resolves successfully (with `null` / `[]`).
 */
export class Git extends Context.Service<
  Git,
  {
    /** `null` when on detached HEAD or `rev-parse` fails. */
    readonly currentBranch: (directory: string) => Effect.Effect<string | null, ReactDoctorError>;
    /** Best-effort default branch: `origin/HEAD` symref, then `main`/`master`. */
    readonly defaultBranch: (directory: string) => Effect.Effect<string | null, ReactDoctorError>;
    readonly branchExists: (
      directory: string,
      branch: string,
    ) => Effect.Effect<boolean, ReactDoctorError>;
    /**
     * High-level diff selection: resolves current branch + base
     * branch + changed file list with the same semantics as the
     * legacy `getDiffInfo` helper. `null` when no diff is detectable
     * (detached HEAD without explicit base, no default branch, etc.).
     */
    readonly diffSelection: (
      input: GitDiffSelectionInput,
    ) => Effect.Effect<GitDiffSelection | null, ReactDoctorError>;
    /** Files staged for commit (null-separated, `--diff-filter=ACMR`). */
    readonly stagedFilePaths: (
      directory: string,
    ) => Effect.Effect<ReadonlyArray<string>, ReactDoctorError>;
    /** `git show :<path>` contents; `null` when the file isn't in the index. */
    readonly showStagedContent: (
      directory: string,
      relativePath: string,
      options?: GitShowOptions,
    ) => Effect.Effect<string | null, ReactDoctorError>;
    /**
     * `git grep -l` (default). Returns `null` when git itself isn't
     * available or the directory isn't a repository so callers can
     * fall back to a filesystem walk.
     */
    readonly grep: (input: GitGrepInput) => Effect.Effect<GitGrepResult | null, ReactDoctorError>;
  }
>()("react-doctor/Git") {
  static readonly layerNode: Layer.Layer<Git> = Layer.sync(Git, () => {
    const currentBranch = (directory: string): Effect.Effect<string | null, ReactDoctorError> =>
      invokeGitSync(directory, ["rev-parse", "--abbrev-ref", "HEAD"]).pipe(
        Effect.map((result) => {
          if (result.status !== 0) return null;
          const branch = trimOrNull(result.stdout);
          return branch === "HEAD" ? null : branch;
        }),
      );

    const defaultBranch = (directory: string): Effect.Effect<string | null, ReactDoctorError> =>
      Effect.gen(function* () {
        const symref = yield* invokeGitSync(directory, [
          "symbolic-ref",
          "refs/remotes/origin/HEAD",
        ]);
        if (symref.status === 0) {
          const trimmed = trimOrNull(symref.stdout);
          if (trimmed !== null) return trimmed.replace("refs/remotes/origin/", "");
        }
        const candidateRefs = DEFAULT_BRANCH_CANDIDATES.map(
          (candidate) => `refs/heads/${candidate}`,
        );
        const candidates = yield* invokeGitSync(directory, [
          "for-each-ref",
          "--format=%(refname:short)",
          ...candidateRefs,
        ]);
        if (candidates.status !== 0) return null;
        return trimOrNull(candidates.stdout.split("\n")[0] ?? "");
      });

    const branchExists = (
      directory: string,
      branch: string,
    ): Effect.Effect<boolean, ReactDoctorError> =>
      invokeGitSync(directory, ["rev-parse", "--verify", branch]).pipe(
        Effect.map((result) => result.status === 0),
      );

    return Git.of({
      currentBranch,
      defaultBranch,
      branchExists,
      diffSelection: ({ directory, explicitBaseBranch }) =>
        Effect.gen(function* () {
          if (explicitBaseBranch !== undefined && explicitBaseBranch.trim().length === 0) {
            return yield* Effect.fail(
              new ReactDoctorError({
                reason: new GitBaseBranchInvalid({
                  detail: "Diff base branch cannot be empty.",
                }),
              }),
            );
          }

          const resolvedCurrentBranch = yield* currentBranch(directory);
          // Detached HEAD is still scannable when an explicit base
          // resolves a merge-base, so we only abandon when both the
          // branch is detached AND the caller didn't pin a base.
          if (resolvedCurrentBranch === null && explicitBaseBranch === undefined) return null;

          const baseBranch = explicitBaseBranch ?? (yield* defaultBranch(directory));
          if (baseBranch === null) return null;

          if (explicitBaseBranch !== undefined) {
            const exists = yield* branchExists(directory, explicitBaseBranch);
            if (!exists) {
              return yield* Effect.fail(
                new ReactDoctorError({
                  reason: new GitBaseBranchMissing({ branch: explicitBaseBranch }),
                }),
              );
            }
          }

          if (resolvedCurrentBranch !== null && resolvedCurrentBranch === baseBranch) {
            const uncommitted = yield* invokeGitSync(directory, [
              "diff",
              "-z",
              "--name-only",
              "--diff-filter=ACMR",
              "--relative",
              "HEAD",
            ]);
            if (uncommitted.status !== 0) return null;
            const files = splitNullSeparated(uncommitted.stdout);
            if (files.length === 0) return null;
            return {
              currentBranch: resolvedCurrentBranch,
              baseBranch,
              changedFiles: files,
              isCurrentChanges: true,
            } satisfies GitDiffSelection;
          }

          const mergeBase = yield* invokeGitSync(directory, ["merge-base", baseBranch, "HEAD"]);
          if (mergeBase.status !== 0) return null;
          const mergeBaseRef = trimOrNull(mergeBase.stdout);
          if (mergeBaseRef === null) return null;

          const diff = yield* invokeGitSync(directory, [
            "diff",
            "-z",
            "--name-only",
            "--diff-filter=ACMR",
            "--relative",
            mergeBaseRef,
          ]);
          if (diff.status !== 0) return null;
          return {
            currentBranch: resolvedCurrentBranch,
            baseBranch,
            changedFiles: splitNullSeparated(diff.stdout),
            isCurrentChanges: false,
          } satisfies GitDiffSelection;
        }),
      stagedFilePaths: (directory) =>
        invokeGitSync(directory, [
          "diff",
          "--cached",
          "-z",
          "--name-only",
          "--diff-filter=ACMR",
          "--relative",
        ]).pipe(
          Effect.map((result) => {
            if (result.status !== 0) return [] as ReadonlyArray<string>;
            return splitNullSeparated(result.stdout);
          }),
        ),
      showStagedContent: (directory, relativePath, options) =>
        invokeGitSync(directory, ["show", `:${relativePath}`], {
          maxBufferBytes: options?.maxBufferBytes,
        }).pipe(Effect.map((result) => (result.status === 0 ? result.stdout : null))),
      grep: (input) =>
        Effect.gen(function* () {
          const args: string[] = ["grep"];
          if (input.listMatchingFiles ?? true) args.push("-l");
          if (input.includeUntracked ?? false) args.push("--untracked");
          if (input.extendedRegexp ?? false) args.push("-E");
          args.push(input.pattern);
          if (input.includePaths && input.includePaths.length > 0) {
            args.push("--", ...input.includePaths);
          }
          const result = yield* invokeGitSync(input.directory, args, {
            maxBufferBytes: input.maxBufferBytes,
          });
          // Status null = git wasn't found (already raised by `invokeGitSync`).
          // Status 128 = not a git repo → caller should fall back.
          if (result.status === null || result.status === 128) return null;
          return { status: result.status, stdout: result.stdout } satisfies GitGrepResult;
        }),
    });
  });

  /**
   * Test layer driven by a deterministic `Map<command, response>`.
   * Each key is the joined git argv (e.g. `"diff -z --name-only ..."`)
   * and each value is the canned `GitInvocationResult`. Unknown
   * commands resolve to a `status: 1, stdout: ""` (mirroring
   * "ran but no output") so tests don't have to enumerate every
   * subcommand the production path might issue. Two convenience
   * snapshots — `currentBranch` and `stagedFiles` — short-circuit
   * the two most common test fixtures.
   */
  static readonly layerOf = (snapshot: {
    readonly currentBranch?: string | null;
    readonly defaultBranch?: string | null;
    readonly branchExists?: ReadonlyMap<string, boolean>;
    readonly stagedFiles?: ReadonlyArray<string>;
    readonly stagedContent?: ReadonlyMap<string, string>;
    readonly diffSelection?: GitDiffSelection | null;
    readonly grepMatches?: ReadonlyArray<string> | null;
  }): Layer.Layer<Git> =>
    Layer.succeed(
      Git,
      Git.of({
        currentBranch: () => Effect.succeed(snapshot.currentBranch ?? null),
        defaultBranch: () => Effect.succeed(snapshot.defaultBranch ?? null),
        branchExists: (_directory, branch) =>
          Effect.succeed(snapshot.branchExists?.get(branch) ?? false),
        diffSelection: () => Effect.succeed(snapshot.diffSelection ?? null),
        stagedFilePaths: () => Effect.succeed(snapshot.stagedFiles ?? []),
        showStagedContent: (_directory, relativePath) =>
          Effect.succeed(snapshot.stagedContent?.get(relativePath) ?? null),
        grep: () =>
          Effect.sync(() => {
            const matches = snapshot.grepMatches;
            if (matches === null || matches === undefined) return null;
            const stdout = matches.length === 0 ? "" : `${matches.join("\n")}\n`;
            return { status: matches.length === 0 ? 1 : 0, stdout } satisfies GitGrepResult;
          }),
      }),
    );
}
