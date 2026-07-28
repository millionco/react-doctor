import * as Effect from "effect/Effect";
import type { ReactDoctorError } from "../errors.js";
import type { ChangedFileLineRanges } from "../types/index.js";

export interface GitBaselineDiffPlan {
  readonly baseFiles: ReadonlyArray<string>;
  readonly headFiles: ReadonlyArray<string>;
  readonly untrackedFiles: ReadonlyArray<string>;
}

export interface GitDiffSelection {
  /** `null` when `HEAD` is detached. */
  readonly currentBranch: string | null;
  readonly baseBranch: string;
  /** Commit the changed-file diff was computed against. Absent for working-tree selections. */
  readonly diffBaseRef?: string;
  readonly changedFiles: ReadonlyArray<string>;
  readonly isCurrentChanges: boolean;
}

export interface GitDiffSelectionInput {
  readonly directory: string;
  readonly explicitBaseBranch?: string;
  /** Include ordinary untracked files in working-tree selections. */
  readonly includeUntracked?: boolean;
}

export interface GitShowOptions {
  /** Maximum stdout bytes before the content read fails open. */
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
  /** Ref to diff against; omit for working-tree or index diffs. */
  readonly baseRef?: string;
  /** Diff the index instead of the working tree. */
  readonly cached?: boolean;
  readonly files: ReadonlyArray<string>;
  /** Treat ordinary untracked files as fully changed. Ignored for cached diffs. */
  readonly includeUntracked?: boolean;
}

export interface GitService {
  /** Current branch, or `null` on detached HEAD or invocation failure. */
  readonly currentBranch: (directory: string) => Effect.Effect<string | null, ReactDoctorError>;
  /** Best-effort origin default branch, then `main` or `master`. */
  readonly defaultBranch: (directory: string) => Effect.Effect<string | null, ReactDoctorError>;
  /** Current commit SHA, or `null` outside a Git worktree. */
  readonly headSha: (directory: string) => Effect.Effect<string | null, ReactDoctorError>;
  /** GitHub owner/repository parsed from `remote.origin.url`. */
  readonly githubRepo: (directory: string) => Effect.Effect<string | null, ReactDoctorError>;
  readonly githubViewerPermission: (input: {
    readonly directory: string;
    readonly repo: string;
  }) => Effect.Effect<string | null, ReactDoctorError>;
  readonly branchExists: (
    directory: string,
    branch: string,
  ) => Effect.Effect<boolean, ReactDoctorError>;
  /** Merge-base of the ref and `HEAD`, or `null` when unavailable. */
  readonly mergeBase: (input: {
    readonly directory: string;
    readonly ref: string;
  }) => Effect.Effect<string | null, ReactDoctorError>;
  readonly diffSelection: (
    input: GitDiffSelectionInput,
  ) => Effect.Effect<GitDiffSelection | null, ReactDoctorError>;
  /** Side-aware changed paths with rename detection disabled. */
  readonly baselineDiffPlan: (input: {
    readonly directory: string;
    readonly ref: string;
  }) => Effect.Effect<GitBaselineDiffPlan | null, ReactDoctorError>;
  readonly stagedFilePaths: (
    directory: string,
  ) => Effect.Effect<ReadonlyArray<string>, ReactDoctorError>;
  /** Index contents for a project-relative path. */
  readonly showStagedContent: (
    directory: string,
    relativePath: string,
    options?: GitShowOptions,
  ) => Effect.Effect<string | null, ReactDoctorError>;
  /** File contents at a ref for a project-relative path. */
  readonly showRefContent: (input: {
    readonly directory: string;
    readonly ref: string;
    readonly relativePath: string;
    readonly options?: GitShowOptions;
  }) => Effect.Effect<string | null, ReactDoctorError>;
  /** Git grep result, or `null` when the caller should use a filesystem fallback. */
  readonly grep: (input: GitGrepInput) => Effect.Effect<GitGrepResult | null, ReactDoctorError>;
  /** New-side changed line ranges, or `null` when the caller should use file-level scope. */
  readonly changedLineRanges: (
    input: GitChangedLineRangesInput,
  ) => Effect.Effect<ReadonlyArray<ChangedFileLineRanges> | null, ReactDoctorError>;
}
