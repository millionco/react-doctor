import type { ChangedFileLineRanges } from "./inspect.js";

export interface GitLayerSnapshot {
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
}

export interface GitInvocationResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandInvocationInput {
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

export interface GitDiffRange {
  /** Left endpoint (before the operator); empty string defaults to `HEAD`. */
  readonly base: string;
  /** Right endpoint (after the operator); empty string defaults to `HEAD`. */
  readonly head: string;
  /**
   * `true` for three-dot `A...B` (diff from the merge-base of A and B to
   * B), `false` for two-dot `A..B` (diff A directly against B). Mirrors
   * git's own `diff` range semantics.
   */
  readonly symmetric: boolean;
}

export interface GitBaselineDiffPlan {
  readonly baseFiles: ReadonlyArray<string>;
  readonly headFiles: ReadonlyArray<string>;
  readonly untrackedFiles: ReadonlyArray<string>;
}

export interface GitDiffSelection {
  /**
   * `null` when `HEAD` is detached (e.g. GitHub Actions
   * `pull_request` runs that check out `refs/pull/N/merge`).
   */
  readonly currentBranch: string | null;
  readonly baseBranch: string;
  /**
   * The commit the changed-file diff was actually computed against — for
   * two-dot `A..B` it's `A`, for three-dot `A...B` and the single-base path
   * it's the merge-base. Baseline reads base content from here so the file set
   * and the base snapshot agree (two-dot must NOT be merge-based with HEAD).
   * Absent for uncommitted (`isCurrentChanges`) selections.
   */
  readonly diffBaseRef?: string;
  readonly changedFiles: ReadonlyArray<string>;
  readonly isCurrentChanges: boolean;
}

export interface GitDiffSelectionInput {
  readonly directory: string;
  readonly explicitBaseBranch?: string;
  /**
   * Fold ordinary untracked files (`git ls-files --others`, minus ignored
   * ones) into the working-tree selection. Off by default — opt in via the
   * CLI `--include-untracked` flag. Never applies to an explicit `A..B` range.
   */
  readonly includeUntracked?: boolean;
}

export interface GitShowOptions {
  /**
   * Hard limit on the bytes `git show :<path>` may stream before the
   * read fails (so the caller skips the file rather than buffering it
   * whole). Enforced by `runCommand` via a streaming byte counter.
   */
  readonly maxBufferBytes?: number;
}

export interface GitGrepInput {
  readonly directory: string;
  readonly pattern: string;
  readonly extendedRegexp?: boolean;
  readonly listMatchingFiles?: boolean;
  readonly includeUntracked?: boolean;
  readonly includePaths?: ReadonlyArray<string>;
  readonly maxBufferBytes?: number;
}

export interface GitGrepResult {
  readonly status: number;
  readonly stdout: string;
}

export interface GitChangedLineRangesInput {
  readonly directory: string;
  /** Ref to diff against; omit for working-tree / index diffs. */
  readonly baseRef?: string;
  /** When `true`, diff the index (`--cached`) instead of the working tree. */
  readonly cached?: boolean;
  /** Files to limit the diff to (relative to `directory`). */
  readonly files: ReadonlyArray<string>;
  /**
   * When `true`, treat any of `files` that is an ordinary untracked file as
   * fully changed (every line new). Off by default; ignored when `cached`.
   */
  readonly includeUntracked?: boolean;
}
