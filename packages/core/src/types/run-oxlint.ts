import type { WorkerSlots } from "../utils/create-worker-slots.js";
import type { ReactDoctorConfig } from "./config.js";
import type { ProjectInfo } from "./project-info.js";

export interface RunOxlintOptions {
  rootDirectory: string;
  project: ProjectInfo;
  includePaths?: string[];
  nodeBinaryPath?: string;
  customRulesOnly?: boolean;
  respectInlineDisables?: boolean;
  adoptExistingLintConfig?: boolean;
  ignoredTags?: ReadonlySet<string>;
  includedTags?: ReadonlySet<string>;
  includeTagDefaults?: boolean;
  /**
   * Optional react-doctor user config (already-loaded
   * `react-doctor.config.json` or `package.json#reactDoctor`). When
   * provided, project-level knobs the rule surface honors —
   * currently `serverAuthFunctionNames` — are forwarded to the
   * generated oxlint settings so plugin rules can read them via
   * `context.settings`. `userConfig.plugins` resolves through
   * `configSourceDirectory` (or `rootDirectory` as the fallback).
   */
  userConfig?: ReactDoctorConfig | null;
  /**
   * Directory of the `react-doctor.config.json` (or `package.json`)
   * that supplied `userConfig`. Used as the resolution base for
   * `userConfig.plugins` entries — relative paths resolve against
   * this directory and npm package names resolve through its
   * `node_modules`, matching how `rootDir` resolves. Diverges from
   * `rootDirectory` whenever `userConfig.rootDir` redirects the scan.
   *
   * Defaults to `rootDirectory` for direct callers that don't load
   * a config file.
   */
  configSourceDirectory?: string;
  /**
   * Called once per soft-fail event (e.g. a batch hit
   * `OXLINT_SPAWN_TIMEOUT_MS` and was skipped). The lint scan keeps
   * going on remaining batches; the caller is expected to surface
   * the warning to the user (via `skippedCheckReasons` in JSON
   * mode, or a logger message in human mode).
   */
  onPartialFailure?: (reason: string) => void;
  onFileCoverage?: (coverage: LintFileCoverage) => void;
  onFileProgress?: (scannedFileCount: number, totalFileCount: number) => void;
  /**
   * Enables the per-file lint cache, resolved from the
   * `PerFileLintCacheEnabled` Reference. When on (and the scan is eligible —
   * no audit mode, no adopted `extends`, no user plugins), unchanged files
   * replay their cached cacheable-rule diagnostics and only changed files are
   * re-linted; the cross-file rules always run fresh on every file (in the
   * misses' full pass, and in a sidecar pass over the cache hits).
   */
  perFileLintCacheEnabled?: boolean;
  /**
   * Enables the sidecar lint cache, resolved from the
   * `SidecarLintCacheEnabled` Reference. When on (and the per-file cache is
   * active), each cache-hit file's cross-file diagnostics replay from the
   * sidecar store as long as the file's recorded dependency probes still
   * match the tree; only mismatching files re-lint. Off → every cache hit
   * runs the always-fresh sidecar pass (the pre-cache behavior).
   */
  sidecarLintCacheEnabled?: boolean;
  /**
   * Called once after the cache split with `(cacheHitFileCount,
   * totalConsideredFileCount)`. Surfaced to the Sentry wide event as
   * `lintCacheHitRatio`. Not invoked when the cache is disabled or bypassed.
   */
  onCacheStats?: (cacheHitFileCount: number, totalConsideredFileCount: number) => void;
  /**
   * Called once with `(sidecarReplayedFileCount, sidecarConsideredFileCount)`
   * — how many cache-hit files replayed their cross-file diagnostics from
   * the sidecar store vs. the hits considered. Surfaced to the Sentry wide
   * event as `lint.sidecarReplayRatio`. Not invoked when the sidecar cache
   * is disabled or bypassed.
   */
  onSidecarStats?: (sidecarReplayedFileCount: number, sidecarConsideredFileCount: number) => void;
  /** Per-batch wall-clock budget, resolved from the `OxlintSpawnTimeoutMs` Reference. */
  spawnTimeoutMs?: number;
  /** Per-batch stdout+stderr byte cap, resolved from the `OxlintOutputMaxBytes` Reference. */
  outputMaxBytes?: number;
  /**
   * Number of oxlint subprocesses to run in parallel, resolved from the
   * `OxlintConcurrency` Reference (which itself defaults to parallel —
   * auto-detected cores). Omitting it here uses the low-level serial
   * default; the orchestrated path always threads the Reference value
   * through. A parallel pass auto-falls-back to serial on resource
   * exhaustion (see `spawnLintBatches`).
   */
  concurrency?: number;
  spawnSlots?: WorkerSlots;
  /**
   * Aborted when the orchestrator's lint-phase timeout fires; forwarded to
   * `spawnLintBatches` so in-flight oxlint subprocesses are torn down instead
   * of running on after the phase is abandoned.
   */
  signal?: AbortSignal;
  /** See `SpawnLintBatchesInput.deadlineEpochMs`. */
  deadlineEpochMs?: number;
  /**
   * Full-scan batch planning, resolved from the `LintBatchOrdering`
   * Reference. `"cost"` (the default) plans size-balanced LPT batches via
   * `planLintBatches`; `"arrival"` is the rollback hatch to the plain greedy
   * fixed-size chunking in discovery order. Only affects the full-scan branch
   * (`includePaths` undefined) — diff / staged scans pass explicit paths and
   * are untouched.
   */
  lintBatchOrdering?: "cost" | "arrival";
}

export interface LintFileCoverage {
  readonly candidateFiles: ReadonlyArray<string>;
  readonly analyzedFiles: ReadonlyArray<string>;
}
