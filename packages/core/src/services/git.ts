import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import { DEFAULT_BRANCH_CANDIDATES } from "../constants.js";
import {
  GitBaseBranchInvalid,
  GitBaseBranchMissing,
  GitInvocationFailed,
  ReactDoctorError,
} from "../errors.js";

interface GitInvocationResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

const trimOrNull = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

/**
 * Defense against `--diff <evil>` git-flag injection (CVE-2018-17456
 * shape). `git rev-parse --verify <ref>` and `git merge-base <ref>
 * HEAD` take the next positional as a refname — but a value starting
 * with `-` (e.g. `--upload-pack=evil`) is parsed as an option
 * instead. The composite-action `case "$DIFF_BASE" in -*)` guard
 * already blocks the most common CI shape; this hardens the library
 * boundary so local-CLI callers and other consumers don't have to
 * re-implement the check.
 *
 * Rejects: empty, leading `-`, leading/trailing `.`, embedded `..`,
 * `@{` reflog suffix, or any character outside `[A-Za-z0-9_./-]`.
 */
const SAFE_GIT_REVISION_PATTERN = /^[A-Za-z0-9_./-]+$/;

const isSafeGitRevision = (candidate: string): boolean => {
  if (candidate.length === 0) return false;
  if (candidate.startsWith("-")) return false;
  if (candidate.startsWith(".") || candidate.endsWith(".")) return false;
  if (candidate.includes("..") || candidate.includes("@{")) return false;
  return SAFE_GIT_REVISION_PATTERN.test(candidate);
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
  /**
   * Soft limit on the maximum bytes `git show :<path>` may return.
   * Currently advisory — `ChildProcess`'s stream-based reader has
   * no built-in cap. Kept on the interface so callers can document
   * their expectations and so a future `Stream.takeWhile` byte
   * counter can enforce it without changing call sites.
   */
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
 * `Git` wraps every `git`-via-subprocess call react-doctor makes
 * behind a `Context.Service`. The production layer (`layerNode`)
 * runs commands through Effect's `ChildProcessSpawner` + `ChildProcess.make`
 * (from `effect/unstable/process`), so spawning, stdio draining,
 * scope-bound cleanup, and error tagging all live inside the
 * Effect runtime — no `node:child_process` imports outside this
 * file. Tests swap in `layerOf({ ... })` for a deterministic snapshot.
 *
 * All methods fail with `ReactDoctorError`; "git ran but produced
 * no matches" still resolves successfully (with `null` / `[]`).
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
  static readonly layerNode: Layer.Layer<Git> = Layer.effect(
    Git,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner;

      /**
       * Spawns `git <args>` via Effect's `ChildProcess` + the
       * captured `ChildProcessSpawner`. Drains stdout / stderr /
       * exitCode in parallel so the pipe never blocks on a full
       * buffer, and folds any `PlatformError` (binary missing,
       * ENOENT, EACCES, …) into the tagged `ReactDoctorError({
       * reason: GitInvocationFailed })` so the rest of the codebase
       * sees a single failure channel.
       */
      const runGit = (
        directory: string,
        args: ReadonlyArray<string>,
      ): Effect.Effect<GitInvocationResult, ReactDoctorError> =>
        Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* spawner.spawn(
              // HACK: `extendEnv: true` is required for the spawned
              // git to inherit `process.env.PATH` — without it Effect's
              // `ChildProcess` defaults to an empty env and `spawn`
              // immediately fails with `ENOENT: git` even when git is
              // on the user's PATH. (`spawnSync` inherited PATH by
              // default; ChildProcess's option flips the polarity.)
              ChildProcess.make("git", [...args], { cwd: directory, extendEnv: true }),
            );
            const [stdout, stderr, status] = yield* Effect.all(
              [
                Stream.mkString(Stream.decodeText(handle.stdout)),
                Stream.mkString(Stream.decodeText(handle.stderr)),
                handle.exitCode,
              ],
              { concurrency: 3 },
            );
            return { status, stdout, stderr } satisfies GitInvocationResult;
          }),
        ).pipe(
          Effect.catchTag(
            "PlatformError",
            (cause) =>
              new ReactDoctorError({
                reason: new GitInvocationFailed({ args: [...args], directory, cause }),
              }),
          ),
        );

      const currentBranch = (directory: string): Effect.Effect<string | null, ReactDoctorError> =>
        runGit(directory, ["rev-parse", "--abbrev-ref", "HEAD"]).pipe(
          Effect.map((result) => {
            if (result.status !== 0) return null;
            const branch = trimOrNull(result.stdout);
            return branch === "HEAD" ? null : branch;
          }),
        );

      const defaultBranch = (directory: string): Effect.Effect<string | null, ReactDoctorError> =>
        Effect.gen(function* () {
          const symref = yield* runGit(directory, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
          if (symref.status === 0) {
            const trimmed = trimOrNull(symref.stdout);
            if (trimmed !== null) return trimmed.replace("refs/remotes/origin/", "");
          }
          const candidateRefs = DEFAULT_BRANCH_CANDIDATES.map(
            (candidate) => `refs/heads/${candidate}`,
          );
          const candidates = yield* runGit(directory, [
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
        runGit(directory, ["rev-parse", "--verify", branch]).pipe(
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
            if (explicitBaseBranch !== undefined && !isSafeGitRevision(explicitBaseBranch)) {
              return yield* Effect.fail(
                new ReactDoctorError({
                  reason: new GitBaseBranchInvalid({
                    detail: `Diff base branch "${explicitBaseBranch}" is not a valid git ref name (must match [A-Za-z0-9_./-] without leading '-', '..', or '@{').`,
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
              const uncommitted = yield* runGit(directory, [
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

            const mergeBase = yield* runGit(directory, ["merge-base", baseBranch, "HEAD"]);
            if (mergeBase.status !== 0) return null;
            const mergeBaseRef = trimOrNull(mergeBase.stdout);
            if (mergeBaseRef === null) return null;

            const diff = yield* runGit(directory, [
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
          runGit(directory, [
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
        showStagedContent: (directory, relativePath) =>
          runGit(directory, ["show", `:${relativePath}`]).pipe(
            Effect.map((result) => (result.status === 0 ? result.stdout : null)),
          ),
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
            const result = yield* runGit(input.directory, args);
            // Status 128 = "not a git repo" → caller should fall back.
            if (result.status === 128) return null;
            return { status: result.status, stdout: result.stdout } satisfies GitGrepResult;
          }),
      });
    }),
  ).pipe(Layer.provide(NodeServices.layer));

  /**
   * Test layer driven by a deterministic snapshot. Each key is a
   * convenience pre-canned response so tests don't have to enumerate
   * every subcommand the production path might issue. Missing keys
   * resolve to safe defaults (current branch null, no staged files,
   * grep returns null = "git unavailable, fall back").
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
