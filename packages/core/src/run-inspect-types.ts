import * as Effect from "effect/Effect";
import type { DiagnosticSurface, ProjectInfo } from "./types/index.js";

export interface InspectInput {
  readonly directory: string;
  readonly includePaths: ReadonlyArray<string>;
  readonly customRulesOnly: boolean;
  readonly respectInlineDisables: boolean;
  /**
   * Per-call override for `ReactDoctorConfig.warnings`. When omitted,
   * the loaded config's `warnings` value wins (defaulting to `true`),
   * so warnings surface unless the user opts out via `--no-warnings` or
   * `warnings: false`.
   */
  readonly warnings?: boolean;
  readonly adoptExistingLintConfig: boolean;
  readonly ignoredTags: ReadonlySet<string>;
  readonly includedTags?: ReadonlySet<string>;
  readonly includeTagDefaults?: boolean;
  readonly nodeBinaryPath?: string;
  /** Whether dead-code analysis runs. Gated also on `!isDiffMode`. */
  readonly runDeadCode: boolean;
  /** Marks the run as CI-originated for the Score API. */
  readonly isCi: boolean;
  /** react-doctor release version sent with score requests. */
  readonly doctorVersion?: string;
  /** Random per-run id. */
  readonly runId?: string;
  /** Enables best-effort authenticated local GitHub permission lookup for score metadata. */
  readonly resolveLocalGithubViewerPermission?: boolean;
  /**
   * Diagnostic surface fed to the Score service. Defaults to `"score"`,
   * which excludes weak-signal rule families (e.g. `design`-tagged) from
   * the score so they can't dilute the headline number. Public-API shells
   * (`inspect()` / `diagnose()`) leave this at the default; pass `"cli"`
   * (or any other surface) to score against an unfiltered diagnostic set.
   *
   * The returned `InspectOutput.diagnostics` is always the full
   * per-element-filtered list — surface filtering only affects scoring.
   */
  readonly scoreSurface?: DiagnosticSurface;
  /**
   * Suppresses the orchestrator's own persistent "Scanned N files"
   * success line. The live scan spinner still runs for feedback but
   * clears on completion instead of leaving a status line behind. The
   * CLI sets this when scanning multiple projects so it can render a
   * single aggregate "Scanned N files" line in their place — the
   * per-project file count + scan duration are surfaced on
   * `InspectOutput` for that summary. Lint / dead-code failures still
   * surface their own spinner state regardless of this flag.
   */
  readonly suppressScanSummary?: boolean;
  /**
   * When `true`, `includePaths` is linted verbatim instead of being filtered
   * to React Doctor's supported source-file set. Editor scans use this for the
   * exact buffer supplied by the language server.
   */
  readonly skipExplicitIncludePathFilter?: boolean;
  /**
   * Whether the scanned project's `package.json` is among the changed files
   * in a diff / staged scan. Dependency health is a whole-project property
   * (read from `package.json`, not the changed source files), so the
   * supply-chain check is normally skipped in diff mode — but a PR that edits
   * `package.json` should still have its dependencies scored. When `true`,
   * the supply-chain pass runs even in diff mode. Ignored on full scans
   * (those always run it). Defaults to `false`.
   */
  readonly supplyChainManifestChanged?: boolean;
  /**
   * Set when this scan runs concurrently with sibling scans in one process
   * (the CLI's multi-project pool). Such a scan can't safely reason about the
   * shared memory budget from its own available-memory reading — N concurrent
   * scans each reading "plenty available" would each fork a dead-code worker
   * and sum past the single-scan budget — so the dead-code overlap memory gate
   * (`"auto"`) stays sequential for concurrent members. An explicit
   * `REACT_DOCTOR_DEAD_CODE_OVERLAP=on` override still wins. Defaults to `false`.
   */
  readonly concurrentScan?: boolean;
  /**
   * Absolute epoch-millisecond deadline for the scan (the CLI's
   * `--max-duration` budget resolved against the scan start). Past it the
   * scan degrades gracefully: un-started lint batches are skipped (surfaced
   * via `skippedCheckReasons["lint:partial"]` with the file list) and the
   * dead-code phase is skipped or capped to the remaining budget.
   */
  readonly deadlineEpochMs?: number;
}

/**
 * Hooks the caller participates in without owning the orchestration.
 * Today the CLI uses `beforeLint` to render the project-detection
 * block before lint runs; `afterLint` is invoked once lint (and any
 * downstream dead-code) finishes so the caller can attach side-effects
 * keyed on whether lint failed. Per-phase spinner reporting is owned
 * by the `Progress` service — the caller provides `Progress.layerOra`
 * or `Progress.layerNoop` rather than threading spinner handles
 * through hooks.
 */
export interface InspectHooks<HooksR = never> {
  readonly beforeLint?: (
    project: ProjectInfo,
    lintIncludePaths: ReadonlyArray<string> | undefined,
  ) => Effect.Effect<void, never, HooksR>;
  readonly afterLint?: (didFail: boolean) => Effect.Effect<void, never, HooksR>;
}
