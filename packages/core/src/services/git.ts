import * as NodeChildProcessSpawner from "@effect/platform-node-shared/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import * as NodePath from "@effect/platform-node-shared/NodePath";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import { DEFAULT_BRANCH_CANDIDATES, GITHUB_VIEWER_PERMISSION_TIMEOUT_MS } from "../constants.js";
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

interface CommandInvocationInput {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly directory: string;
  readonly env?: Record<string, string | undefined>;
  /**
   * Hard cap on stdout bytes. When set, the command fails with a
   * `GitInvocationFailed` once the streamed output crosses the budget
   * instead of buffering the whole payload into memory.
   */
  readonly maxStdoutBytes?: number;
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

const parseGithubRepoFromRemoteUrl = (remoteUrl: string): string | null => {
  const withoutGitSuffix = remoteUrl.trim().replace(/\.git$/, "");
  const sshMatch = /^git@github\.com:([^/\s]+)\/([^/\s]+)$/.exec(withoutGitSuffix);
  if (sshMatch) return `${sshMatch[1]}/${sshMatch[2]}`;

  const urlMatch =
    /^(?:https?:\/\/github\.com\/|ssh:\/\/git@github\.com\/)([^/\s]+)\/([^/\s]+)$/.exec(
      withoutGitSuffix,
    );
  return urlMatch ? `${urlMatch[1]}/${urlMatch[2]}` : null;
};

const parseGithubRepo = (repo: string): { owner: string; name: string } | null => {
  const [owner, name, ...extraParts] = repo.split("/");
  if (owner === undefined || name === undefined || extraParts.length > 0) return null;
  if (owner.length === 0 || name.length === 0) return null;
  return { owner, name };
};

const parseGithubViewerPermission = (stdout: string): string | null => {
  const value = trimOrNull(stdout);
  if (value === null || value === "null") return null;
  return /^[A-Z_]+$/.test(value) ? value.toLowerCase() : null;
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
   * Hard limit on the bytes `git show :<path>` may stream before the
   * read fails (so the caller skips the file rather than buffering it
   * whole). Enforced by `runCommand` via a streaming byte counter.
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
    /** Current commit SHA, or null when the directory is not a git worktree. */
    readonly headSha: (directory: string) => Effect.Effect<string | null, ReactDoctorError>;
    /** GitHub owner/repo parsed from remote.origin.url, or null for non-GitHub remotes. */
    readonly githubRepo: (directory: string) => Effect.Effect<string | null, ReactDoctorError>;
    readonly githubViewerPermission: (input: {
      readonly directory: string;
      readonly repo: string;
    }) => Effect.Effect<string | null, ReactDoctorError>;
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
      const runCommand = (
        input: CommandInvocationInput,
      ): Effect.Effect<GitInvocationResult, ReactDoctorError> =>
        Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* spawner.spawn(
              // HACK: `extendEnv: true` is required for spawned commands
              // to inherit `process.env.PATH` — without it Effect's
              // `ChildProcess` defaults to an empty env and `spawn`
              // immediately fails with `ENOENT` even when the binary is
              // on the user's PATH. (`spawnSync` inherited PATH by
              // default; ChildProcess's option flips the polarity.)
              ChildProcess.make(input.command, [...input.args], {
                cwd: input.directory,
                env: input.env,
                extendEnv: true,
              }),
            );
            // Optional hard cap on stdout bytes (e.g. `git show` of a
            // huge staged blob): count raw bytes as they stream and fail
            // fast once the budget is crossed so the caller can skip the
            // file instead of buffering it whole.
            const maxStdoutBytes = input.maxStdoutBytes;
            const stdoutByteCount = yield* Ref.make(0);
            const stdoutStream =
              maxStdoutBytes === undefined
                ? handle.stdout
                : handle.stdout.pipe(
                    Stream.tap((chunk) =>
                      Ref.updateAndGet(stdoutByteCount, (total) => total + chunk.length).pipe(
                        Effect.flatMap((total) =>
                          total > maxStdoutBytes
                            ? Effect.fail(
                                new ReactDoctorError({
                                  reason: new GitInvocationFailed({
                                    args: [...input.args],
                                    directory: input.directory,
                                    cause: new Error(`git stdout exceeded ${maxStdoutBytes} bytes`),
                                  }),
                                }),
                              )
                            : Effect.void,
                        ),
                      ),
                    ),
                  );
            const [stdout, stderr, status] = yield* Effect.all(
              [
                Stream.mkString(Stream.decodeText(stdoutStream)),
                Stream.mkString(Stream.decodeText(handle.stderr)),
                handle.exitCode,
              ],
              { concurrency: 3 },
            );
            return { status, stdout, stderr } satisfies GitInvocationResult;
          }),
        ).pipe(
          Effect.catchTag("PlatformError", (cause) => {
            if (input.command !== "git") {
              return Effect.succeed({
                status: 127,
                stdout: "",
                stderr: String(cause),
              } satisfies GitInvocationResult);
            }
            return new ReactDoctorError({
              reason: new GitInvocationFailed({
                args: [...input.args],
                directory: input.directory,
                cause,
              }),
            });
          }),
        );

      const runGit = (
        directory: string,
        args: ReadonlyArray<string>,
      ): Effect.Effect<GitInvocationResult, ReactDoctorError> =>
        runCommand({ command: "git", args, directory });

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

      const headSha = (directory: string): Effect.Effect<string | null, ReactDoctorError> =>
        runGit(directory, ["rev-parse", "HEAD"]).pipe(
          Effect.map((result) => (result.status === 0 ? trimOrNull(result.stdout) : null)),
        );

      const githubRepo = (directory: string): Effect.Effect<string | null, ReactDoctorError> =>
        runGit(directory, ["config", "--get", "remote.origin.url"]).pipe(
          Effect.map((result) =>
            result.status === 0 ? parseGithubRepoFromRemoteUrl(result.stdout) : null,
          ),
        );

      const githubViewerPermission = (input: {
        readonly directory: string;
        readonly repo: string;
      }): Effect.Effect<string | null, ReactDoctorError> =>
        Effect.gen(function* () {
          const parsedRepo = parseGithubRepo(input.repo);
          if (parsedRepo === null) return null;

          const query = `
            query($owner: String!, $name: String!) {
              repository(owner: $owner, name: $name) {
                viewerPermission
              }
            }
          `;
          const resultOption = yield* runCommand({
            command: "gh",
            args: [
              "api",
              "graphql",
              "-F",
              `owner=${parsedRepo.owner}`,
              "-F",
              `name=${parsedRepo.name}`,
              "-f",
              `query=${query}`,
              "--jq",
              ".data.repository.viewerPermission",
            ],
            directory: input.directory,
            env: {
              GH_PROMPT_DISABLED: "1",
            },
          }).pipe(Effect.timeoutOption(GITHUB_VIEWER_PERMISSION_TIMEOUT_MS));
          if (Option.isNone(resultOption)) return null;

          const result = resultOption.value;
          if (result.status !== 0) return null;
          return parseGithubViewerPermission(result.stdout);
        }).pipe(Effect.catch(() => Effect.succeed(null)));

      return Git.of({
        currentBranch,
        defaultBranch,
        headSha,
        githubRepo,
        githubViewerPermission,
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
        showStagedContent: (directory, relativePath, options) =>
          runCommand({
            command: "git",
            args: ["show", `:${relativePath}`],
            directory,
            maxStdoutBytes: options?.maxBufferBytes,
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
            const result = yield* runCommand({
              command: "git",
              args,
              directory: input.directory,
              maxStdoutBytes: input.maxBufferBytes,
            });
            // Status 128 = "not a git repo" → caller should fall back.
            if (result.status === 128) return null;
            return { status: result.status, stdout: result.stdout } satisfies GitGrepResult;
          }),
      });
    }),
  ).pipe(
    Layer.provide(
      NodeChildProcessSpawner.layer.pipe(
        Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
      ),
    ),
  );

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
    readonly headSha?: string | null;
    readonly githubRepo?: string | null;
    readonly githubViewerPermission?: string | null;
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
        headSha: () => Effect.succeed(snapshot.headSha ?? null),
        githubRepo: () => Effect.succeed(snapshot.githubRepo ?? null),
        githubViewerPermission: () => Effect.succeed(snapshot.githubViewerPermission ?? null),
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
