import type * as Effect from "effect/Effect";
import type { OxlintUnavailable, ReactDoctorErrorReason } from "../errors.js";
import type { DiagnosticSurface, ReactDoctorConfig } from "./config.js";
import type { Diagnostic, SourceFileEntry, SuppressedRuleCount } from "./diagnostic.js";
import type { ChangedFileLineRanges } from "./inspect.js";
import type { ProjectInfo } from "./project-info.js";
import type { ScoreRequestMetadata, ScoreResult } from "./score.js";

export interface InspectInput {
  readonly directory: string;
  readonly precomputedSourceFileCount?: number;
  readonly precomputedSourceFiles?: ReadonlyArray<SourceFileEntry>;
  readonly includePaths: ReadonlyArray<string>;
  readonly maintainabilityFocusPaths?: ReadonlyArray<string>;
  readonly changedLineRanges?: ReadonlyArray<ChangedFileLineRanges>;
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
  /** Compatibility switch for the built-in React maintainability analysis. */
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
   * `InspectOutput` for that summary. Lint / maintainability failures still
   * surface their own spinner state regardless of this flag.
   */
  readonly suppressScanSummary?: boolean;
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
   * Absolute epoch-millisecond deadline for the scan (the CLI's
   * `--max-duration` budget resolved against the scan start). Past it the
   * scan degrades gracefully: un-started lint batches are skipped (surfaced
   * via `skippedCheckReasons["lint:partial"]` with the file list) and the
   * maintainability phase is skipped or capped to the remaining budget.
   */
  readonly deadlineEpochMs?: number;
  readonly signal?: AbortSignal;
  /** Descendant project roots covered by sibling scans in a workspace batch. */
  readonly excludedProjectDirectories?: ReadonlyArray<string>;
  /** Keep descendant maintainability findings when this scan owns the workspace-wide pass. */
  readonly retainExcludedProjectDeadCodeDiagnostics?: boolean;
}

export interface InspectOutput {
  readonly project: ProjectInfo;
  readonly userConfig: ReactDoctorConfig | null;
  readonly resolvedDirectory: string;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly score: ScoreResult | null;
  readonly scoreMetadata: ScoreRequestMetadata;
  readonly didLintFail: boolean;
  readonly lintFailureReason: string | null;
  /**
   * The `_tag` of `error.reason` when the lint stream raised a
   * `ReactDoctorError`, or `null` otherwise. Lets renderers dispatch
   * on the typed reason without `error.message.includes(...)` style
   * sniffs (e.g. show the "upgrade Node" hint only on
   * `OxlintUnavailable` with `kind: "native-binding-missing"`).
   */
  readonly lintFailureReasonTag: ReactDoctorErrorReason["_tag"] | null;
  /**
   * The `kind` of an `OxlintUnavailable` lint failure
   * (`binary-not-found` / `native-binding-missing`), or `null` for any
   * other failure. Lets renderers show the "upgrade Node" hint by
   * dispatching on structured data instead of matching message text.
   */
  readonly lintFailureReasonKind: OxlintUnavailable["kind"] | null;
  readonly lintPartialFailures: ReadonlyArray<string>;
  /** Compatibility field reporting whether maintainability analysis failed. */
  readonly didDeadCodeFail: boolean;
  readonly deadCodeFailureReason: string | null;
  /** @deprecated Compatibility field that is always `false`. */
  readonly deadCodeOverlapped: boolean;
  /**
   * Number of files the scan reported (lint progress total, falling
   * back to the project source-file count). Surfaced so a caller that
   * sets `suppressScanSummary` can render its own aggregate
   * "Scanned N files" line.
   */
  readonly scannedFileCount: number;
  /**
   * Absolute paths of every file this scan considered. Used by the
   * multi-project summary to count UNIQUE files across projects:
   * nested workspace packages (a parent whose tree contains a child
   * package) would otherwise double-count the shared files when their
   * per-project counts are summed.
   */
  readonly scannedFilePaths: ReadonlyArray<string>;
  /** Project-relative POSIX paths the lint pass completed successfully. */
  readonly analyzedFiles: ReadonlyArray<string>;
  /** Wall-clock duration of the scan phase, in milliseconds. */
  readonly scanElapsedMilliseconds: number;
  /**
   * Resolved lint worker count the linter actually fanned out to (the
   * `OxlintConcurrency` Reference read through the spawn-boundary clamp).
   * Surfaced so CLI telemetry reports the real worker count on the auto
   * path, where the caller's `concurrency` option is `undefined`.
   */
  readonly scanConcurrency: number;
  /**
   * `true` when the background supply-chain fiber hit its overlap budget
   * (`SupplyChainOverlapTimeoutMs`) and failed open to no diagnostics — a
   * rare hung-socket guard, surfaced for telemetry and skipped-check
   * accounting. `false` on the healthy path and whenever supply-chain was
   * skipped (diff/staged scans).
   */
  readonly supplyChainOverlapTimedOut: boolean;
  /**
   * `true` when the forked security scan failed or reached the shared deadline.
   * Filesystem failures fail open to no diagnostics; deadline truncation keeps
   * findings collected before time elapsed. Surfaced for telemetry and
   * skipped-check accounting so an incomplete pass is distinguishable from a
   * clean one with zero findings. `false` on the healthy path and when the pass
   * was skipped (diff/staged scans).
   */
  readonly securityScanFailed: boolean;
  readonly securityScanFailureReason: string | null;
  /**
   * Per-file lint cache outcome for the lint pass: files served from cache and
   * total files considered. Both `null` when the cache was disabled or bypassed
   * (audit mode, adopted `extends`, user plugins) so the run never split. Fed
   * to the Sentry wide event as `lint.cacheHitRatio`.
   */
  readonly lintCacheHitFileCount: number | null;
  readonly lintCacheTotalFileCount: number | null;
  /**
   * Sidecar lint cache outcome for the lint pass: cache-hit files whose
   * cross-file diagnostics replayed from the sidecar store, and the hits
   * considered. Both `null` when the sidecar cache was disabled or bypassed
   * (per-file cache off, `REACT_DOCTOR_NO_SIDECAR_CACHE`, no bounded
   * cross-file rule enabled). Fed to the Sentry wide event as
   * `lint.sidecarReplayRatio`.
   */
  readonly lintSidecarReplayedFileCount: number | null;
  readonly lintSidecarTotalFileCount: number | null;
  /** @deprecated Compatibility field that is always `null`. */
  readonly deadCodeCacheHit: boolean | null;
  /** @deprecated Compatibility field that is always `null`. */
  readonly deadCodeSummaryCacheHits: number | null;
  /** @deprecated Compatibility field that is always `null`. */
  readonly deadCodeSummaryCacheMisses: number | null;
  /**
   * Per-rule tallies of diagnostics the pipeline dropped because the user
   * explicitly silenced the rule (config off switches, per-path overrides,
   * inline disable comments) — see `DiagnosticPipeline.summarizeSuppressions`.
   * Telemetry-only; NOT part of the public `inspect()` `InspectResult`. Note
   * that a `rules: "off"` lint rule is removed from the generated oxlint
   * config upstream and never fires, so its findings can't be counted here —
   * the CLI's scan-level `rule.disabled` counter covers that case.
   */
  readonly suppressedRuleCounts: ReadonlyArray<SuppressedRuleCount>;
}

/** Hooks the caller participates in without owning the orchestration. */
export interface InspectHooks<HooksR = never> {
  readonly beforeLint?: (project: ProjectInfo) => Effect.Effect<void, never, HooksR>;
  readonly afterLint?: (didFail: boolean) => Effect.Effect<void, never, HooksR>;
}
