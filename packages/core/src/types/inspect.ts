import type { DiagnosticSurface, ReactDoctorConfig } from "./config.js";
import type { Diagnostic } from "./diagnostic.js";
import type { ProjectInfo } from "./project-info.js";
import type { ScoreResult } from "./score.js";

export interface InspectResult {
  diagnostics: Diagnostic[];
  score: ScoreResult | null;
  skippedChecks: string[];
  /**
   * Human-readable explanation for each entry in `skippedChecks`. Keyed
   * by check name (e.g. `"lint"`). Optional so existing consumers that
   * only read `skippedChecks` keep working unchanged — but JSON output
   * and CI integrations should prefer this for diagnostic clarity
   * (e.g. distinguishing "oxlint native binding missing" from "oxlint
   * spawn timed out on a large project").
   */
  skippedCheckReasons?: Record<string, string>;
  project: ProjectInfo;
  elapsedMilliseconds: number;
  /**
   * Number of files the scan reported. Distinct from
   * `project.sourceFileCount` in diff / staged mode (where only changed
   * files are scanned). Optional so non-orchestrator constructors keep
   * working; the multi-project summary falls back to
   * `project.sourceFileCount` when absent.
   */
  scannedFileCount?: number;
  /**
   * Absolute paths of every file the scan considered. Lets the
   * multi-project summary count UNIQUE files across projects instead of
   * summing per-project counts, which double-counts shared files when one
   * workspace package's tree is nested inside another's.
   */
  scannedFilePaths?: ReadonlyArray<string>;
  /**
   * Sorted, deduplicated project-relative POSIX paths whose lint analysis
   * completed successfully. Empty when lint did not run or failed before any
   * file completed.
   */
  analyzedFiles?: ReadonlyArray<string>;
  /**
   * Wall-clock duration of the scan phase, in milliseconds. Distinct
   * from `elapsedMilliseconds` (which spans the full `inspect()` call
   * including score fetch + rendering). Used by the multi-project
   * summary to report combined scan time.
   */
  scanElapsedMilliseconds?: number;
  /**
   * Per-file lint cache outcome: files served from cache, and total files
   * considered. Both absent when the cache was off or bypassed (adopted
   * `extends`, user plugins, React Compiler). The CLI projects these onto the
   * Sentry wide event as `lint.cacheHitRatio`.
   */
  lintCacheHitFileCount?: number | null;
  lintCacheTotalFileCount?: number | null;
  /**
   * Sidecar lint cache outcome: cache-hit files whose cross-file diagnostics
   * replayed from the sidecar store, and the hits considered. Both absent
   * when the sidecar cache was off or bypassed. The CLI projects these onto
   * the Sentry wide event as `lint.sidecarReplayRatio`.
   */
  lintSidecarReplayedFileCount?: number | null;
  lintSidecarTotalFileCount?: number | null;
  /**
   * Dead-code result cache outcome: `true` when the pass replayed a cached
   * result (the analysis never ran), `false` on a fresh analysis. Absent when
   * the pass never consulted the cache — dead-code skipped, the cache
   * disabled, or a whole-repo cache replay where no analysis ran. The CLI
   * projects it onto the Sentry wide event as `deadCode.cacheHit`.
   */
  deadCodeCacheHit?: boolean | null;
  /**
   * deslop's incremental summary-cache outcome for the dead-code analysis:
   * collected files served from cached parse summaries vs freshly parsed.
   * Both absent whenever no analysis consulted the incremental store — a
   * whole-result cache hit, the cache disabled, or dead-code skipped. The CLI
   * projects them onto the Sentry wide event as `deadCode.summaryCacheHits` /
   * `deadCode.summaryCacheMisses`.
   */
  deadCodeSummaryCacheHits?: number | null;
  deadCodeSummaryCacheMisses?: number | null;
  /**
   * Present only for a baseline run (`InspectOptions.baseline` set). The
   * `diagnostics` above are then the *introduced* findings only; this
   * carries the comparison totals for Codecov-style delta reporting.
   */
  baselineDelta?: {
    /** The commit the base content was read from (resolved merge-base). */
    baseRef: string;
    /** Findings present at base but gone at head — resolved by the change. */
    fixedCount: number;
    /** Total findings at base (over the same files), for context. */
    baseTotalCount: number;
  };
}

/**
 * Options accepted by `inspect()`. Mixes two concern groups; ordered
 * here in the source to make the split visible to future readers:
 *
 *   - **Engine inputs** (`lint`, `deadCode`, `includePaths`,
 *     `configOverride`, `respectInlineDisables`) — flow into
 *     `runInspect`'s `InspectInput` and shape what the engine
 *     actually does.
 *   - **Rendering / orchestration knobs** (`scoreOnly`, `noScore`,
 *     `silent`, `verbose`, `outputSurface`, `isCi`) — consumed by
 *     the public-API shell to decide what to print, which surface
 *     to filter for, and whether to mark the run as CI-originated.
 *
 * A full type split was investigated as the plan's T4 follow-up but
 * deferred — every call site builds the union anyway, so the gain
 * was purely documentary. Grouping the fields here captures the
 * same intent without churning a published-API type.
 */
export interface InspectOptions {
  // ── Engine inputs ────────────────────────────────────────────────
  lint?: boolean;
  /** See `ReactDoctorConfig.deadCode`. Ignored in diff / staged mode. */
  deadCode?: boolean;
  /**
   * Whether to run the Socket.dev supply-chain scan. Resolves against
   * `ReactDoctorConfig.supplyChain.enabled` (this wins when set), defaulting
   * to `true`. Kept as an option — not folded into the config — so it takes
   * precedence over per-project config on every scan, like `lint`/`deadCode`.
   */
  supplyChain?: boolean;
  /** Restrict linting to these supported JS/TS source files. */
  includePaths?: string[];
  configOverride?: ReactDoctorConfig | null;
  /**
   * Directory of the config file that supplied `configOverride`, when it was
   * loaded from disk. Anchors relative `configOverride.plugins` resolution at
   * the config file's location instead of the scan root. Ignored without
   * `configOverride`.
   */
  configSourceDirectory?: string;
  respectInlineDisables?: boolean;
  /**
   * Whether the scanned project's `package.json` changed in this diff /
   * staged scan. Forwarded to the orchestrator so the Socket supply-chain
   * check still runs in diff mode when the manifest changed (a PR that
   * adds or bumps a dependency), instead of being skipped like the other
   * whole-project checks. Ignored on full scans. Defaults to `false`.
   */
  supplyChainManifestChanged?: boolean;
  /**
   * Baseline comparison. When set (only meaningful alongside
   * `includePaths`, i.e. a diff scan), `inspect()` runs a second lint pass
   * over the same files as they existed at `ref` and reports only the
   * diagnostics the change *introduced* — pre-existing findings that merely
   * shifted lines are matched out. The returned `score` is still the head
   * scan's; `InspectResult.baselineDelta` carries the fixed / base counts.
   * `ref` should be a resolved commit (e.g. the merge-base) whose content
   * `git show <ref>:<file>` can read.
   */
  baseline?: { ref: string };
  /**
   * Restrict reported diagnostics to those whose source spans intersect the
   * lines the change touched (`--scope lines`). Each entry is one changed file with the
   * inclusive 1-based `[start, end]` line ranges the diff added/modified,
   * keyed by a path relative to the scanned directory (forward slashes).
   * Applied at the same post-lint seam as `baseline` — the score is still
   * computed on the full head set, so only the displayed / gated diagnostics
   * narrow. Mutually exclusive with `baseline` in practice (one scope value).
   */
  changedLineRanges?: ReadonlyArray<ChangedFileLineRanges>;
  /**
   * Number of oxlint subprocesses to run in parallel during the lint
   * pass. Overrides the `OxlintConcurrency` Reference (env-seeded) for
   * this run. `undefined` leaves the ambient default in place (parallel:
   * auto-detect cores unless `REACT_DOCTOR_PARALLEL` pins a count); the
   * CLI's `--no-parallel` flag resolves to `1` (serial) here. A parallel
   * run automatically falls back to serial if it exhausts system
   * resources. Out-of-range values are clamped to the supported worker
   * range at the spawn boundary.
   */
  concurrency?: number;
  /**
   * Scan time budget in milliseconds (the CLI's `--max-duration`, in
   * seconds). When the budget runs out mid-scan, the run degrades
   * gracefully instead of failing: lint batches that haven't started are
   * skipped (listed in `skippedCheckReasons["lint:partial"]`) and the
   * dead-code phase is skipped or capped to the remaining budget, so
   * partial results are still reported. In-flight work is allowed to
   * finish, so the wall clock can overshoot the budget by up to one
   * lint batch. A programmatic `inspect()` call applies the budget to that
   * call alone; the CLI shares one budget across every project of a
   * workspace scan via an internal absolute deadline. `undefined` (the
   * default) applies no budget.
   */
  maxDurationMs?: number;
  /**
   * Per-call override for `ReactDoctorConfig.warnings`. When omitted,
   * `config.warnings` wins (defaulting to `true`), so `"warning"`-
   * severity diagnostics surface on every surface — CLI, PR comment,
   * score, and the `--blocking` gate — until explicitly hidden via
   * `--no-warnings` or `warnings: false`.
   */
  warnings?: boolean;

  // ── Rendering / orchestration knobs ──────────────────────────────
  verbose?: boolean;
  /**
   * Directory to write the full diagnostics dump into (diagnostics.json +
   * one .txt per rule), resolved against the working directory. Defaults
   * to a fresh temp directory per run (`--output-dir`).
   */
  outputDirectory?: string;
  scoreOnly?: boolean;
  noScore?: boolean;
  /**
   * Marks the run as CI-originated. Suppresses the share URL in the
   * printed summary; does not imply `--no-score`.
   */
  isCi?: boolean;
  silent?: boolean;
  /**
   * Surface that consumes the printed diagnostic output (terminal
   * summary + per-rule list). Defaults to `"cli"`, which shows every
   * diagnostic. Set to `"prComment"` when capturing output destined
   * for a PR comment — weak-signal rule families (default: `design`
   * tag) are dropped from the printed list and replaced with a
   * one-line "N more demoted" hint so they don't bury real React
   * findings. The returned `InspectResult.diagnostics` always
   * contains the full, unfiltered list so JSON consumers can see
   * everything.
   */
  outputSurface?: DiagnosticSurface;
  /**
   * Suppresses the per-project diagnostic/score rendering while
   * keeping progress spinners. The CLI sets this when scanning
   * multiple projects so it can render one aggregate summary
   * instead of N individual ones.
   */
  suppressRendering?: boolean;
  /**
   * Set when multiple `inspect()` calls run concurrently in one process
   * (the CLI's multi-project pool). The scan keeps its telemetry
   * span-scoped — it neither resets nor writes the process-global Sentry
   * run state (scanned project, active run trace), so overlapping scans
   * can't clear or mislabel each other's attribution. Defaults to `false`.
   */
  concurrentScan?: boolean;
}

/**
 * One changed file plus the inclusive 1-based `[start, end]` line ranges the
 * diff added or modified. Produced by `parseChangedLineRanges` / the Git
 * service's `changedLineRanges`, consumed by the `lines` scope filter.
 */
export interface ChangedFileLineRanges {
  /** Path relative to the scanned directory, forward-slash separated. */
  readonly file: string;
  readonly ranges: ReadonlyArray<readonly [number, number]>;
}

export interface DiffInfo {
  /**
   * `null` when `HEAD` is detached (e.g. GitHub Actions `pull_request`
   * runs that check out `refs/pull/N/merge`). The diff itself still
   * resolves via `git merge-base <base> HEAD`; callers should render
   * this case as `"(detached HEAD)"` or similar.
   */
  currentBranch: string | null;
  baseBranch: string;
  /**
   * Resolved base commit SHA, when known (the GitHub Action forwards
   * `pull_request.base.sha`). Preferred over `baseBranch` for baseline
   * merge-base resolution because a branch name often doesn't resolve in a
   * shallow PR checkout, whereas the fetched SHA always does.
   */
  baseSha?: string;
  /**
   * The commit the changed-file diff was computed against (see
   * `GitDiffSelection.diffBaseRef`). Baseline mode reads base content from
   * here so a two-dot `A..B` range reads from `A` directly instead of being
   * incorrectly merge-based with HEAD.
   */
  diffBaseRef?: string;
  changedFiles: string[];
  isCurrentChanges?: boolean;
}

export type JsonReportMode = "full" | "diff" | "staged" | "baseline";

export interface JsonReportBaselineInfo {
  /** Resolved base commit (merge-base) the head was compared against. */
  baseRef: string;
  /** Count of introduced findings (equals `summary.totalDiagnosticCount`). */
  newCount: number;
  /** Count of findings the change resolved (present at base, gone at head). */
  fixedCount: number;
  /** Total findings at base over the same files, for context. */
  baseTotalCount: number;
}

export interface JsonReportDiffInfo {
  baseBranch: string;
  /** `null` when `HEAD` is detached — see `DiffInfo.currentBranch`. */
  currentBranch: string | null;
  changedFileCount: number;
  isCurrentChanges: boolean;
}

export interface JsonReportProjectEntry {
  directory: string;
  project: ProjectInfo;
  diagnostics: Diagnostic[];
  score: ScoreResult | null;
  skippedChecks: string[];
  /** Human-readable explanation per skipped check. See `InspectResult.skippedCheckReasons`. */
  skippedCheckReasons?: Record<string, string>;
  /**
   * Number of source files this scan's linter examined. In diff / changed
   * mode it's the count of changed supported JS/TS source files; in a full
   * scan it's the whole source tree. `0` in a diff scan means the changed
   * files held nothing React Doctor lints —
   * the GitHub Action reads that as "nothing to report" (skips the PR comment;
   * the commit status says "skipped"). Optional: absent on reports from
   * constructors that don't track it (e.g. `toJsonReport`).
   */
  scannedFileCount?: number;
  elapsedMilliseconds: number;
}

export interface JsonReportDiagnosticV3 extends Diagnostic {
  id: string;
  normalizedFilePath: string;
  tags: string[];
}

export interface JsonReportProjectEntryV3 {
  directory: string;
  packageRoot: string;
  framework: ProjectInfo["framework"];
  project: ProjectInfo;
  diagnostics: JsonReportDiagnosticV3[];
  score: ScoreResult | null;
  skippedChecks: string[];
  skippedCheckReasons?: Record<string, string>;
  analyzedFiles: string[];
  analyzedFileCount: number;
  complete: boolean;
  scannedFileCount?: number;
  elapsedMilliseconds: number;
}

export interface JsonReportSummary {
  errorCount: number;
  warningCount: number;
  affectedFileCount: number;
  totalDiagnosticCount: number;
  score: number | null;
  scoreLabel: string | null;
}

export interface JsonReportError {
  message: string;
  name: string;
  chain: string[];
  /**
   * Sentry event id for the crash, when the run reported one (CLI crash
   * path in CI). Lets the GitHub Action surface a quotable reference so a
   * failed scan can be traced back to its Sentry event. `null` for expected
   * user errors and synthetic fallbacks that never hit Sentry.
   */
  sentryEventId?: string | null;
}

export interface JsonReportV1 {
  schemaVersion: 1;
  version: string;
  ok: boolean;
  directory: string;
  mode: JsonReportMode;
  baselineDegraded?: boolean;
  /**
   * Whether any scanned project resolved a React-compatible runtime (React
   * or Preact). `false` means every React-runtime rule family was gated off,
   * so an empty `diagnostics` array is vacuous — NOT the same as a clean
   * React scan. Consumers gating on the report (CI, verifiers, hooks) should
   * treat `reactDetected === false` as "wrong scan target", not "all clear"
   * (per project, `projects[].project.reactVersion` / `preactVersion` say
   * which roots were non-React). Absent when nothing was scanned (`projects`
   * is empty), on error reports, and on reports from older CLI versions.
   */
  reactDetected?: boolean;
  diff: JsonReportDiffInfo | null;
  projects: JsonReportProjectEntry[];
  /**
   * Flattened across `projects[].diagnostics` for convenience. Equivalent to
   * `projects.flatMap((project) => project.diagnostics)`.
   */
  diagnostics: Diagnostic[];
  summary: JsonReportSummary;
  elapsedMilliseconds: number;
  error: JsonReportError | null;
}

/**
 * Baseline (PR-introduced-issues-only) report. Structurally a superset of v1
 * — every v1 field is present with identical meaning, so consumers that only
 * read `summary` / `diagnostics` / `ok` work unchanged — plus a `baseline`
 * block and `mode: "baseline"`. Here `diagnostics` (and `summary`'s counts)
 * are the *introduced* findings only; `summary.score` is still the head
 * scan's project-health score. New consumers branch on `schemaVersion === 2`.
 */
export interface JsonReportV2 extends Omit<JsonReportV1, "schemaVersion" | "baselineDegraded"> {
  schemaVersion: 2;
  baseline: JsonReportBaselineInfo;
}

export interface JsonReportV3 extends Omit<
  JsonReportV1,
  "schemaVersion" | "projects" | "diagnostics"
> {
  schemaVersion: 3;
  baseline?: JsonReportBaselineInfo;
  projects: JsonReportProjectEntryV3[];
  diagnostics: JsonReportDiagnosticV3[];
}

export type JsonReport = JsonReportV1 | JsonReportV2 | JsonReportV3;
