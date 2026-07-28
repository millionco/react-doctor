import * as NodeChildProcessSpawner from "@effect/platform-node-shared/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import * as NodePath from "@effect/platform-node-shared/NodePath";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import { DEFAULT_BRANCH_CANDIDATES, GITHUB_VIEWER_PERMISSION_TIMEOUT_MS } from "../constants.js";
import { GitBaseBranchInvalid, GitBaseBranchMissing, ReactDoctorError } from "../errors.js";
import { parseChangedLineRanges } from "../parse-changed-line-ranges.js";
import type { ChangedFileLineRanges } from "../types/index.js";
import { makeGitCommandExecutor, type GitCommandResult } from "./git-command-executor.js";
import {
  GIT_REF_NAME_RULE,
  isSafeGitRevision,
  parseGitDiffRange,
  type GitDiffRange,
} from "./git-revision-policy.js";
import {
  parseGitBaselineDiffPlan,
  parseGithubRemoteRepository,
  parseGithubViewerPermission,
  splitNullSeparatedGitOutput,
  trimGitOutputOrNull,
} from "./git-output.js";
import type {
  GitBaselineDiffPlan,
  GitDiffSelection,
  GitGrepResult,
  GitService,
} from "./git-types.js";

export type { GitBaselineDiffPlan, GitDiffSelection } from "./git-types.js";

const parseGithubRepo = (repo: string): { owner: string; name: string } | null => {
  const [owner, name, ...extraParts] = repo.split("/");
  if (owner === undefined || name === undefined || extraParts.length > 0) return null;
  if (owner.length === 0 || name.length === 0) return null;
  return { owner, name };
};

// An untracked file has no base to diff against, so `--scope lines` treats
// every line as changed by spanning the whole file (1 → last possible line).
const UNTRACKED_FILE_LAST_LINE = Number.MAX_SAFE_INTEGER;

/**
 * `Git` wraps every `git`-via-subprocess call react-doctor makes
 * behind a `Context.Service`. The production layer (`layerNode`)
 * delegates to `git-command-executor.ts`, which runs commands through
 * Effect's `ChildProcessSpawner` + `ChildProcess.make`. Spawning, stdio
 * draining, scope-bound cleanup, and error tagging therefore stay inside
 * the Effect runtime. Tests swap in `layerOf({ ... })` for a deterministic
 * snapshot.
 *
 * All methods fail with `ReactDoctorError`; "git ran but produced
 * no matches" still resolves successfully (with `null` / `[]`).
 */
export class Git extends Context.Service<Git, GitService>()("react-doctor/Git") {
  static readonly layerNode: Layer.Layer<Git> = Layer.effect(
    Git,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner;
      const runCommand = makeGitCommandExecutor(spawner);

      const runGit = (
        directory: string,
        args: ReadonlyArray<string>,
      ): Effect.Effect<GitCommandResult, ReactDoctorError> =>
        runCommand({ command: "git", args, directory });

      const listUntrackedFilePaths = (
        directory: string,
        includePaths: ReadonlyArray<string> = [],
      ): Effect.Effect<ReadonlyArray<string> | null, ReactDoctorError> =>
        runGit(directory, [
          "ls-files",
          "-z",
          "--others",
          "--exclude-standard",
          ...(includePaths.length > 0 ? ["--", ...includePaths] : []),
        ]).pipe(
          Effect.map((result) =>
            result.status === 0 ? splitNullSeparatedGitOutput(result.stdout) : null,
          ),
        );

      // Unions opted-in untracked files into a working-tree selection. Untracked
      // inclusion is best-effort: a failed listing keeps the tracked diff rather
      // than discarding it; off, it's a no-op passthrough.
      const mergeUntracked = (
        directory: string,
        trackedFilePaths: ReadonlyArray<string>,
        includeUntracked: boolean,
      ): Effect.Effect<ReadonlyArray<string>, ReactDoctorError> =>
        includeUntracked
          ? listUntrackedFilePaths(directory).pipe(
              Effect.map((untracked) =>
                untracked === null
                  ? trackedFilePaths
                  : [...new Set([...trackedFilePaths, ...untracked])],
              ),
            )
          : Effect.succeed(trackedFilePaths);

      const currentBranch = (directory: string): Effect.Effect<string | null, ReactDoctorError> =>
        runGit(directory, ["rev-parse", "--abbrev-ref", "HEAD"]).pipe(
          Effect.map((result) => {
            if (result.status !== 0) return null;
            const branch = trimGitOutputOrNull(result.stdout);
            return branch === "HEAD" ? null : branch;
          }),
          // Best-effort branch read: a non-zero exit already maps to null, but a
          // spawn failure (git not installed — e.g. a bare container) surfaces as
          // a tagged failure. `diffSelection` calls this first during diff
          // auto-detection, so let it degrade to "unknown branch" instead of
          // crashing the whole scan and reporting an env issue to Sentry.
          Effect.orElseSucceed(() => null),
        );

      const defaultBranch = (directory: string): Effect.Effect<string | null, ReactDoctorError> =>
        Effect.gen(function* () {
          const symref = yield* runGit(directory, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
          if (symref.status === 0) {
            const trimmed = trimGitOutputOrNull(symref.stdout);
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
          return trimGitOutputOrNull(candidates.stdout.split("\n")[0] ?? "");
        }).pipe(Effect.withSpan("Git.defaultBranch"));

      const branchExists = (
        directory: string,
        branch: string,
      ): Effect.Effect<boolean, ReactDoctorError> =>
        runGit(directory, ["rev-parse", "--verify", branch]).pipe(
          Effect.map((result) => result.status === 0),
          Effect.catch((error) =>
            error.reason._tag === "GitInvocationFailed"
              ? Effect.succeed(false)
              : Effect.fail(error),
          ),
        );

      const headSha = (directory: string): Effect.Effect<string | null, ReactDoctorError> =>
        runGit(directory, ["rev-parse", "HEAD"]).pipe(
          Effect.map((result) => (result.status === 0 ? trimGitOutputOrNull(result.stdout) : null)),
        );

      const mergeBase = (input: {
        readonly directory: string;
        readonly ref: string;
      }): Effect.Effect<string | null, ReactDoctorError> =>
        isSafeGitRevision(input.ref)
          ? runGit(input.directory, ["merge-base", input.ref, "HEAD"]).pipe(
              Effect.map((result) =>
                result.status === 0 ? trimGitOutputOrNull(result.stdout) : null,
              ),
            )
          : Effect.succeed(null);

      const githubRepo = (directory: string): Effect.Effect<string | null, ReactDoctorError> =>
        runGit(directory, ["config", "--get", "remote.origin.url"]).pipe(
          Effect.map((result) =>
            result.status === 0 ? parseGithubRemoteRepository(result.stdout) : null,
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
        }).pipe(
          Effect.catch(() => Effect.succeed(null)),
          Effect.withSpan("Git.githubViewerPermission"),
        );

      /**
       * Resolves a `--diff A..B` / `A...B` commit range into a changed-file
       * selection. Each endpoint is validated with `isSafeGitRevision`
       * BEFORE it reaches `git` (so the range syntax can't smuggle a
       * `--upload-pack=…`-style option past the CVE-2018-17456 guard) and
       * verified to exist, then the diff runs between the two commits with
       * the same `--diff-filter=ACMR` shape the single-base path uses.
       */
      const resolveDiffRange = (input: {
        readonly directory: string;
        readonly range: GitDiffRange;
        readonly raw: string;
      }): Effect.Effect<GitDiffSelection | null, ReactDoctorError> =>
        Effect.gen(function* () {
          if (input.range.base.length === 0 && input.range.head.length === 0) {
            return yield* Effect.fail(
              new ReactDoctorError({
                reason: new GitBaseBranchInvalid({
                  detail: `Diff range "${input.raw}" must name at least one commit (e.g. "main..feature").`,
                }),
              }),
            );
          }

          const baseRef = input.range.base.length === 0 ? "HEAD" : input.range.base;
          const headRef = input.range.head.length === 0 ? "HEAD" : input.range.head;

          for (const endpoint of [baseRef, headRef]) {
            if (!isSafeGitRevision(endpoint)) {
              return yield* Effect.fail(
                new ReactDoctorError({
                  reason: new GitBaseBranchInvalid({
                    detail: `Diff range "${input.raw}" has an invalid endpoint "${endpoint}" (${GIT_REF_NAME_RULE}).`,
                  }),
                }),
              );
            }
          }

          for (const endpoint of [baseRef, headRef]) {
            const exists = yield* branchExists(input.directory, endpoint);
            if (!exists) {
              return yield* Effect.fail(
                new ReactDoctorError({
                  reason: new GitBaseBranchMissing({ branch: endpoint }),
                }),
              );
            }
          }

          let diffBaseRef = baseRef;
          if (input.range.symmetric) {
            const mergeBase = yield* runGit(input.directory, ["merge-base", baseRef, headRef]);
            if (mergeBase.status !== 0) return null;
            const mergeBaseRef = trimGitOutputOrNull(mergeBase.stdout);
            if (mergeBaseRef === null) return null;
            diffBaseRef = mergeBaseRef;
          }

          const diff = yield* runGit(input.directory, [
            "diff",
            "--no-ext-diff",
            "-z",
            "--name-only",
            "--diff-filter=ACMR",
            "--relative",
            diffBaseRef,
            headRef,
          ]);
          if (diff.status !== 0) return null;
          // `currentBranch` keeps the same contract as the single-base path:
          // the working tree's branch, or `null` on a detached HEAD. The
          // range's head endpoint is an explicit commit, not the checked-out
          // branch, so it must not leak into this field.
          const resolvedCurrentBranch = yield* currentBranch(input.directory);
          return {
            currentBranch: resolvedCurrentBranch,
            baseBranch: baseRef,
            diffBaseRef,
            changedFiles: splitNullSeparatedGitOutput(diff.stdout),
            isCurrentChanges: false,
          } satisfies GitDiffSelection;
        });

      return Git.of({
        currentBranch,
        defaultBranch,
        headSha,
        githubRepo,
        githubViewerPermission,
        branchExists,
        mergeBase,
        baselineDiffPlan: (input) => {
          if (!isSafeGitRevision(input.ref)) return Effect.succeed(null);
          return Effect.gen(function* () {
            const unmerged = yield* runGit(input.directory, [
              "diff",
              "--no-ext-diff",
              "-z",
              "--name-only",
              "--diff-filter=U",
              "--relative",
            ]);
            if (unmerged.status !== 0 || unmerged.stdout.length > 0) return null;
            const result = yield* runGit(input.directory, [
              "diff",
              "--no-ext-diff",
              "--no-textconv",
              "--no-renames",
              "-z",
              "--name-status",
              "--relative",
              input.ref,
            ]);
            if (result.status !== 0) return null;
            const plan = parseGitBaselineDiffPlan(result.stdout);
            if (plan === null) return null;
            const untracked = yield* runGit(input.directory, [
              "ls-files",
              "--others",
              "--exclude-standard",
              "-z",
            ]);
            if (untracked.status !== 0) return null;
            return {
              baseFiles: plan.baseFiles,
              headFiles: plan.headFiles,
              untrackedFiles: splitNullSeparatedGitOutput(untracked.stdout),
            } satisfies GitBaselineDiffPlan;
          }).pipe(
            Effect.catch(() => Effect.succeed(null)),
            Effect.withSpan("Git.baselineDiffPlan"),
          );
        },
        diffSelection: ({ directory, explicitBaseBranch, includeUntracked = false }) =>
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
            if (explicitBaseBranch !== undefined) {
              // `A..B` / `A...B` is git's own "diff this range" syntax — a
              // natural thing for a coding agent to pass. Route it to the
              // range resolver (which validates each endpoint) instead of
              // rejecting the embedded `..` as a single malformed ref.
              const range = parseGitDiffRange(explicitBaseBranch);
              if (range !== null) {
                return yield* resolveDiffRange({ directory, range, raw: explicitBaseBranch });
              }
              if (!isSafeGitRevision(explicitBaseBranch)) {
                return yield* Effect.fail(
                  new ReactDoctorError({
                    reason: new GitBaseBranchInvalid({
                      detail: `Diff base branch "${explicitBaseBranch}" is not a valid git ref name (${GIT_REF_NAME_RULE}).`,
                    }),
                  }),
                );
              }
            }

            const resolvedCurrentBranch = yield* currentBranch(directory);
            // Detached HEAD is still scannable when an explicit base
            // resolves a merge-base, so we only abandon when both the
            // branch is detached AND the caller didn't pin a base.
            if (resolvedCurrentBranch === null && explicitBaseBranch === undefined) return null;

            const baseBranch = explicitBaseBranch ?? (yield* defaultBranch(directory));
            if (baseBranch === null) return null;
            // An explicit base was validated above, but the auto-detected
            // default branch derives from repo-controlled data (the
            // `origin/HEAD` symref) — validate it the same way before it
            // reaches git argv, degrading to "no diff" like the other
            // unresolvable-base paths instead of passing an option-shaped
            // token to `git merge-base`.
            if (!isSafeGitRevision(baseBranch)) return null;

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
                "--no-ext-diff",
                "-z",
                "--name-only",
                "--diff-filter=ACMR",
                "--relative",
                "HEAD",
              ]);
              if (uncommitted.status !== 0) return null;
              const files = yield* mergeUntracked(
                directory,
                splitNullSeparatedGitOutput(uncommitted.stdout),
                includeUntracked,
              );
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
            const mergeBaseRef = trimGitOutputOrNull(mergeBase.stdout);
            if (mergeBaseRef === null) return null;

            const diff = yield* runGit(directory, [
              "diff",
              "--no-ext-diff",
              "-z",
              "--name-only",
              "--diff-filter=ACMR",
              "--relative",
              mergeBaseRef,
            ]);
            if (diff.status !== 0) return null;
            const changedFiles = yield* mergeUntracked(
              directory,
              splitNullSeparatedGitOutput(diff.stdout),
              includeUntracked,
            );
            return {
              currentBranch: resolvedCurrentBranch,
              baseBranch,
              diffBaseRef: mergeBaseRef,
              changedFiles,
              isCurrentChanges: false,
            } satisfies GitDiffSelection;
          }).pipe(Effect.withSpan("Git.diffSelection")),
        stagedFilePaths: (directory) =>
          runGit(directory, [
            "diff",
            "--no-ext-diff",
            "--cached",
            "-z",
            "--name-only",
            "--diff-filter=ACMR",
            "--relative",
          ]).pipe(
            Effect.map((result) => {
              if (result.status !== 0) return [] as ReadonlyArray<string>;
              return splitNullSeparatedGitOutput(result.stdout);
            }),
          ),
        showStagedContent: (directory, relativePath, options) =>
          runCommand({
            command: "git",
            // The `./` prefix is required for the same reason as `showRefContent`
            // below: git reads a bare `:<path>` index pathspec relative to the
            // REPO ROOT, but `relativePath` is relative to `directory` (the
            // scanned project, which may be a monorepo subproject). `:./` makes
            // git resolve it against the cwd, so a subproject's staged content is
            // read correctly instead of silently missing (the whole file set
            // would otherwise be skipped and `--staged` scans nothing).
            args: ["show", `:./${relativePath}`],
            directory,
            maxStdoutBytes: options?.maxBufferBytes,
          }).pipe(Effect.map((result) => (result.status === 0 ? result.stdout : null))),
        showRefContent: ({ directory, ref, relativePath, options }) =>
          // Validate the ref before it reaches git: `git show <ref>:<path>`
          // takes the next token as a revision, so an unguarded `-`-leading
          // value could smuggle an option (CVE-2018-17456 shape).
          //
          // The `./` prefix is required: in `git show <ref>:<path>`, a bare
          // path is resolved relative to the REPO ROOT, but `relativePath` is
          // relative to `directory` (the scanned project, which may be a
          // monorepo subproject). `./` makes git resolve it relative to the cwd
          // instead, so a subproject's base content is read correctly rather
          // than silently missing (which would make every finding look "new").
          isSafeGitRevision(ref)
            ? runCommand({
                command: "git",
                args: ["show", `${ref}:./${relativePath}`],
                directory,
                maxStdoutBytes: options?.maxBufferBytes,
              }).pipe(Effect.map((result) => (result.status === 0 ? result.stdout : null)))
            : Effect.succeed(null),
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
          }).pipe(Effect.withSpan("Git.grep")),
        changedLineRanges: ({ directory, baseRef, cached, files, includeUntracked = false }) =>
          Effect.gen(function* () {
            if (files.length === 0) return [];
            // An unsafe base ref can't reach git (CVE-2018-17456 shape) and a
            // failed diff both mean "couldn't compute" — return null so the
            // caller degrades to file-level scope rather than hiding everything.
            if (baseRef !== undefined && !isSafeGitRevision(baseRef)) return null;
            const result = yield* runGit(directory, [
              "diff",
              "--no-ext-diff",
              "--unified=0",
              "--diff-filter=ACMR",
              "--relative",
              ...(cached ? ["--cached"] : []),
              ...(baseRef !== undefined ? [baseRef] : []),
              "--",
              ...files,
            ]);
            if (result.status !== 0) return null;
            const changedLineRanges = parseChangedLineRanges(result.stdout);
            if (cached || !includeUntracked) return changedLineRanges;
            // Best-effort, like `mergeUntracked`: a failed untracked listing keeps
            // the tracked ranges rather than nulling the whole lines selection.
            const untrackedFilePaths = yield* listUntrackedFilePaths(directory, files);
            if (untrackedFilePaths === null) return changedLineRanges;
            return [
              ...changedLineRanges,
              ...untrackedFilePaths.map(
                (file): ChangedFileLineRanges => ({
                  file,
                  ranges: [[1, UNTRACKED_FILE_LAST_LINE]],
                }),
              ),
            ];
          }).pipe(
            // A git invocation failure (binary missing, or a synchronous spawn
            // throw such as ENAMETOOLONG on a 1k-file `--scope lines` diff) means
            // "couldn't compute" — degrade to file-level scope per this method's
            // documented null contract instead of crashing the scan.
            Effect.catch((error) =>
              error.reason._tag === "GitInvocationFailed"
                ? Effect.succeed(null)
                : Effect.fail(error),
            ),
            Effect.withSpan("Git.changedLineRanges"),
          ),
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
    /** Keyed by the `ref` argument; value is the resolved merge-base SHA. */
    readonly mergeBase?: ReadonlyMap<string, string>;
    readonly baselineDiffPlan?: GitBaselineDiffPlan | null;
    readonly stagedFiles?: ReadonlyArray<string>;
    readonly stagedContent?: ReadonlyMap<string, string>;
    /** Keyed by `<ref>:<relativePath>`. */
    readonly refContent?: ReadonlyMap<string, string>;
    readonly diffSelection?: GitDiffSelection | null;
    readonly grepMatches?: ReadonlyArray<string> | null;
    readonly changedLineRanges?: ReadonlyArray<ChangedFileLineRanges>;
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
        mergeBase: ({ ref }) => Effect.succeed(snapshot.mergeBase?.get(ref) ?? null),
        baselineDiffPlan: () => Effect.succeed(snapshot.baselineDiffPlan ?? null),
        diffSelection: () => Effect.succeed(snapshot.diffSelection ?? null),
        stagedFilePaths: () => Effect.succeed(snapshot.stagedFiles ?? []),
        showStagedContent: (_directory, relativePath) =>
          Effect.succeed(snapshot.stagedContent?.get(relativePath) ?? null),
        showRefContent: ({ ref, relativePath }) =>
          Effect.succeed(snapshot.refContent?.get(`${ref}:${relativePath}`) ?? null),
        grep: () =>
          Effect.sync(() => {
            const matches = snapshot.grepMatches;
            if (matches === null || matches === undefined) return null;
            const stdout = matches.length === 0 ? "" : `${matches.join("\n")}\n`;
            return { status: matches.length === 0 ? 1 : 0, stdout } satisfies GitGrepResult;
          }),
        changedLineRanges: () => Effect.succeed(snapshot.changedLineRanges ?? []),
      }),
    );
}
