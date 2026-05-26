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
  includePaths?: string[];
  configOverride?: ReactDoctorConfig | null;
  respectInlineDisables?: boolean;

  // ── Rendering / orchestration knobs ──────────────────────────────
  verbose?: boolean;
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
  changedFiles: string[];
  isCurrentChanges?: boolean;
}

export type JsonReportMode = "full" | "diff" | "staged";

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
}

export interface JsonReport {
  schemaVersion: 1;
  version: string;
  ok: boolean;
  directory: string;
  mode: JsonReportMode;
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
