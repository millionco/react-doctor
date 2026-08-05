import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import {
  buildSkippedChecks,
  type ChangedFileLineRanges,
  computeDiagnosticDelta,
  createOxlintSpawnSlots,
  DEFAULT_SHOW_WARNINGS,
  type Diagnostic,
  type DiagnosticSurface,
  filterDiagnosticsForSurface,
  filterPathsOutsideDirectories,
  filterSourceFiles,
  highlighter,
  type InspectOptions,
  type InspectResult,
  OXLINT_NODE_REQUIREMENT,
  OxlintConcurrency,
  PerFileLintCacheEnabled,
  type Progress,
  type ProjectInfo,
  type ReactDoctorConfig,
  resolveScanTarget,
  resolveScanConcurrency,
  restoreLegacyThrow,
  runInspect as runInspectEffect,
  type ScoreResult,
  type Reporter,
  SidecarLintCacheEnabled,
  type WorkerSlots,
  yieldToEventLoop,
} from "@react-doctor/core";
import type * as Layer from "effect/Layer";
import { activeScanAbortRegistry } from "./cli/utils/active-scan-abort-registry.js";
import { applyObservability } from "./cli/utils/apply-observability.js";
import { buildRuntimeLayers } from "./cli/utils/build-runtime-layers.js";
import {
  recordSentryProjectContext,
  resetSentryRunState,
  withSentryRunSpan,
} from "./cli/utils/with-sentry-run-span.js";
import type { SentryRootSpan } from "./cli/utils/with-sentry-run-span.js";
import { BASELINE_FILES_TEMP_DIR_PREFIX, METRIC } from "./cli/utils/constants.js";
import { recordCount } from "./cli/utils/record-metric.js";
import { recordScanMetrics } from "./cli/utils/record-scan-metrics.js";
import { recordRunEvent } from "./cli/utils/build-run-event.js";
import { resolveWorkerTelemetry } from "./cli/utils/resolve-worker-telemetry.js";
import { countDeadlineSkippedFiles } from "./cli/utils/count-deadline-skipped-files.js";
import { countDroppedLintFiles } from "./cli/utils/count-dropped-lint-files.js";
import { toForwardSlashes } from "./cli/utils/path-format.js";
import { diagnosticIntersectsLineRanges } from "./cli/utils/diagnostic-intersects-line-ranges.js";
import { makeNoopConsole } from "./cli/utils/noop-console.js";
import { materializeBaselineFiles } from "./cli/utils/materialize-baseline-files.js";
import { createSourceLineReader } from "./cli/utils/read-source-line.js";
import { createDiagnosticEvidenceReader } from "./cli/utils/read-diagnostic-evidence.js";
import { buildNoScoreMessage } from "./cli/utils/build-no-score-message.js";
import { hasIncompleteScoreAnalysis } from "./cli/utils/has-incomplete-score-analysis.js";
import { buildEmptyReportMessage } from "./cli/utils/build-empty-report-message.js";
import { printAgentGuidance } from "./cli/utils/render-agent-guidance.js";
import { isCiOrCodingAgentEnvironment } from "./cli/utils/is-ci-environment.js";
import { filterDiagnosticsByCategories } from "./cli/utils/filter-diagnostics-by-categories.js";
import { isNonInteractiveEnvironment } from "./cli/utils/is-non-interactive-environment.js";
import { printDiagnosticsDump } from "./cli/utils/print-diagnostics-dump.js";
import { printFooter } from "./cli/utils/print-footer.js";
import { printHeadlessReport } from "./cli/utils/print-headless-report.js";
import { resolveOxlintNode } from "./cli/utils/resolve-oxlint-node.js";
import { resolveCliCategories } from "./cli/utils/resolve-cli-categories.js";
import { getRunId } from "./cli/utils/run-id.js";
import {
  buildScanResultCacheKey,
  createScanResultCacheInvocationState,
  createScanResultCache,
  shouldStoreScanPayload,
  type CachedScanPayload,
  type ScanResultCacheInvocationState,
} from "./cli/utils/scan-result-cache.js";
import { isSpinnerSilent, setSpinnerSilent } from "./cli/utils/spinner.js";
import { VERSION } from "./cli/utils/version.js";

const silentConsole = makeNoopConsole();

interface OxlintInvocationRuntime {
  readonly concurrency: number;
  readonly spawnSlots: WorkerSlots;
  readonly abortSignal: AbortSignal;
  readonly scanResultCacheInvocationState: ScanResultCacheInvocationState;
}

// Builds the `--scope lines` predicate: a diagnostic survives when its source
// span intersects a changed range of its file. `changedLineRanges` is keyed by paths
// relative to `directory`; diagnostic paths are normalized the same way so
// absolute and relative forms both match.
const buildChangedLineMatcher = (
  directory: string,
  changedLineRanges: ReadonlyArray<ChangedFileLineRanges>,
): ((diagnostic: Diagnostic) => boolean) => {
  const rangesByFile = new Map<string, ReadonlyArray<readonly [number, number]>>();
  for (const entry of changedLineRanges) {
    rangesByFile.set(toForwardSlashes(entry.file), entry.ranges);
  }
  return (diagnostic) => {
    const relativePath = toForwardSlashes(
      path.isAbsolute(diagnostic.filePath)
        ? path.relative(directory, diagnostic.filePath)
        : diagnostic.filePath,
    );
    const ranges = rangesByFile.get(relativePath);
    if (ranges === undefined) return false;
    return diagnosticIntersectsLineRanges(diagnostic, ranges);
  };
};

/**
 * CLI-only: layer overrides an interactive UI supplies so the scan streams
 * live diagnostics (and optionally progress) into it instead of the console.
 * When present, all console rendering is suppressed — the UI owns the screen
 * and reads the returned result. The scan engine never learns the UI's
 * concrete store type; it only sees these generic service layers.
 */
export interface InspectUiLayers {
  readonly reporter: Layer.Layer<Reporter>;
  readonly progress?: Layer.Layer<Progress>;
}

export interface ReactDoctorInspectOptions extends InspectOptions {
  /** Internal: source-file count collected once for a workspace batch. */
  precomputedSourceFileCount?: number;
  categoryFilters?: string[];
  includedTags?: ReadonlySet<string>;
  includeTagDefaults?: boolean;
  scoreDisabledMessage?: string;
  /**
   * Internal: an absolute epoch-ms deadline shared across a workspace scan's
   * projects. The CLI sets it so every project honors ONE `--max-duration`
   * budget without restarting it per project, while `maxDurationMs` stays the
   * user's configured value (so telemetry reports what they set). When unset,
   * the deadline is derived from `maxDurationMs` at call start.
   */
  deadlineEpochMs?: number;
  /** Internal: descendant projects covered by sibling scans in the same workspace batch. */
  excludedProjectDirectories?: ReadonlyArray<string>;
  /** Internal: this scan owns dead-code findings for its excluded descendants. */
  retainExcludedProjectDeadCodeDiagnostics?: boolean;
  /** See {@link InspectUiLayers}. */
  uiLayers?: InspectUiLayers;
}

export interface ResolvedInspectOptions {
  lint: boolean;
  deadCode: boolean;
  supplyChain: boolean;
  verbose: boolean;
  /** See `InspectOptions.outputDirectory`. `null` keeps the temp-dir default. */
  outputDirectory: string | null;
  scoreOnly: boolean;
  noScore: boolean;
  isCi: boolean;
  isCiOrCodingAgentEnvironment: boolean;
  isNonInteractiveEnvironment: boolean;
  silent: boolean;
  includePaths: string[];
  customRulesOnly: boolean;
  share: boolean;
  respectInlineDisables: boolean;
  warnings: boolean;
  categoryFilters: ReadonlySet<string>;
  adoptExistingLintConfig: boolean;
  ignoredTags: ReadonlySet<string>;
  includedTags: ReadonlySet<string>;
  includeTagDefaults: boolean;
  scoreDisabledMessage: string | undefined;
  outputSurface: DiagnosticSurface;
  suppressRendering: boolean;
  /** See `InspectOptions.concurrentScan`. */
  concurrentScan: boolean;
  /** Resolved oxlint worker count, or `undefined` to keep the ambient default. */
  concurrency: number | undefined;
  /** Scan time budget in milliseconds, or `null` for no budget. */
  maxDurationMs: number | null;
  /** Baseline ref to subtract (new-only mode), or `null` for a plain scan. */
  baseline: {
    ref: string;
    baseFiles?: ReadonlyArray<string>;
    headFiles?: ReadonlyArray<string>;
  } | null;
  /**
   * `--scope lines`: changed line ranges to restrict reported diagnostics to,
   * or `null` for any other scope. An empty array still filters (a `lines`
   * scope whose files added no lines reports nothing).
   */
  changedLineRanges: ReadonlyArray<ChangedFileLineRanges> | null;
  /** See `InspectOptions.supplyChainManifestChanged`. */
  supplyChainManifestChanged: boolean;
  /** Interactive UI layer overrides, or `null` for the headless console path. */
  uiLayers: InspectUiLayers | null;
  /** Descendant projects covered by sibling scans in the same workspace batch. */
  excludedProjectDirectories: ReadonlyArray<string>;
  /** Whether this scan owns dead-code findings for excluded descendants. */
  retainExcludedProjectDeadCodeDiagnostics: boolean;
  /** Source-file count collected once for a workspace batch. */
  precomputedSourceFileCount: number | undefined;
}

const buildIgnoredTags = (
  userConfig: ReactDoctorConfig | null,
  includedTags: ReadonlySet<string>,
): ReadonlySet<string> => {
  const tags = new Set<string>();
  if (userConfig?.ignore?.tags) {
    for (const tag of userConfig.ignore.tags) tags.add(tag);
  }
  for (const tag of includedTags) tags.delete(tag);
  return tags;
};

const mergeInspectOptions = (
  inputOptions: ReactDoctorInspectOptions,
  userConfig: ReactDoctorConfig | null,
): ResolvedInspectOptions => {
  const includedTags = inputOptions.includedTags ?? new Set<string>();
  return {
    lint: inputOptions.lint ?? userConfig?.lint ?? true,
    deadCode: inputOptions.deadCode ?? userConfig?.deadCode ?? true,
    supplyChain: inputOptions.supplyChain ?? userConfig?.supplyChain?.enabled ?? true,
    verbose: inputOptions.verbose ?? userConfig?.verbose ?? false,
    outputDirectory: inputOptions.outputDirectory || null,
    scoreOnly: inputOptions.scoreOnly ?? false,
    noScore: inputOptions.noScore ?? userConfig?.noScore ?? false,
    isCi: inputOptions.isCi ?? false,
    isCiOrCodingAgentEnvironment: isCiOrCodingAgentEnvironment(),
    isNonInteractiveEnvironment: isNonInteractiveEnvironment(),
    silent: inputOptions.silent ?? false,
    includePaths: inputOptions.includePaths ?? [],
    customRulesOnly: includedTags.size > 0 ? false : (userConfig?.customRulesOnly ?? false),
    share: userConfig?.share ?? true,
    respectInlineDisables:
      inputOptions.respectInlineDisables ?? userConfig?.respectInlineDisables ?? true,
    warnings: inputOptions.warnings ?? userConfig?.warnings ?? DEFAULT_SHOW_WARNINGS,
    categoryFilters: new Set(resolveCliCategories(inputOptions.categoryFilters) ?? []),
    adoptExistingLintConfig:
      includedTags.size > 0 ? false : (userConfig?.adoptExistingLintConfig ?? true),
    ignoredTags: buildIgnoredTags(userConfig, includedTags),
    includedTags,
    includeTagDefaults: inputOptions.includeTagDefaults ?? false,
    scoreDisabledMessage: inputOptions.scoreDisabledMessage,
    outputSurface: inputOptions.outputSurface ?? "cli",
    suppressRendering: (inputOptions.suppressRendering ?? false) || inputOptions.uiLayers != null,
    uiLayers: inputOptions.uiLayers ?? null,
    concurrentScan: inputOptions.concurrentScan ?? false,
    concurrency: inputOptions.concurrency,
    maxDurationMs: inputOptions.maxDurationMs ?? null,
    baseline: inputOptions.baseline ?? null,
    changedLineRanges: inputOptions.changedLineRanges ?? null,
    supplyChainManifestChanged: inputOptions.supplyChainManifestChanged ?? false,
    excludedProjectDirectories: inputOptions.excludedProjectDirectories ?? [],
    retainExcludedProjectDeadCodeDiagnostics:
      inputOptions.retainExcludedProjectDeadCodeDiagnostics ?? false,
    precomputedSourceFileCount: inputOptions.precomputedSourceFileCount,
  };
};

// The scan-config slice of the wide event, shared by the success and failure
// emit paths (the failure path has no `result`, so it can only supply config).
// Reconstruct the resolved scope from the engine inputs (the CLI resolved it
// from `--scope`, but `inspect()` only sees its effects): a baseline ref means
// `changed`, line ranges mean `lines`, any other diff means `files`, else `full`.
// A degraded `lines` run carries no ranges, so it reads as `files`; degraded
// baseline runs keep `changed` and rely on the baseline-degraded fields.
const deriveScope = (options: ResolvedInspectOptions): string => {
  if (options.baseline) return "changed";
  if (options.changedLineRanges !== null) return "lines";
  return options.includePaths.length > 0 ? "files" : "full";
};

const buildRunEventConfig = (
  options: ResolvedInspectOptions,
  userConfig: ReactDoctorConfig | null,
  hasCustomConfig: boolean,
  // The worker count the scan actually resolved to (`output.scanConcurrency`),
  // which is the real value on the auto path where `options.concurrency` is
  // `undefined`. Omitted on the pre-scan failure path (no scan ran), where it
  // falls back to the caller's pin.
  resolvedWorkerCount?: number,
) => {
  const { workerCount, parallel } = resolveWorkerTelemetry(
    resolvedWorkerCount,
    options.concurrency,
  );
  return {
    scope: deriveScope(options),
    parallel,
    workerCount,
    maxDurationMs: options.maxDurationMs,
    lint: options.lint,
    deadCode: options.deadCode,
    supplyChain: options.supplyChain,
    scoreOnly: options.scoreOnly,
    noScore: options.noScore,
    respectInlineDisables: options.respectInlineDisables,
    showWarnings: options.warnings,
    usedOutputDir: options.outputDirectory !== null,
    ignoredTagCount: options.ignoredTags.size,
    hasCustomConfig,
    userConfig,
  };
};

const inspectWithOxlintRuntime = async (
  directory: string,
  inputOptions: ReactDoctorInspectOptions,
  oxlintRuntime: OxlintInvocationRuntime,
): Promise<InspectResult> => {
  const startTime = performance.now();
  // The CLI passes an absolute `deadlineEpochMs` shared across a workspace
  // scan's projects (one budget, not restarted per project). A programmatic
  // caller passes only `maxDurationMs`, so derive the deadline here — before
  // any discovery / native-binding preamble, so that work doesn't silently
  // push the effective budget later. `null` when no budget was set.
  const deadlineEpochMs =
    inputOptions.deadlineEpochMs ??
    (inputOptions.maxDurationMs != null ? Date.now() + inputOptions.maxDurationMs : null);

  // Clear any run-scoped Sentry state from a prior inspect() so a stale
  // project/trace can't leak onto this run's events — including errors thrown
  // before the project is discovered. Concurrent batch members skip this (and
  // every other write to the module-level run state): overlapping scans would
  // clear or overwrite each other's attribution mid-flight.
  const isConcurrentScan = inputOptions.concurrentScan === true;
  if (!isConcurrentScan) resetSentryRunState();

  const configOverride = inputOptions.configOverride;
  const hasConfigOverride = configOverride !== undefined;
  // When the caller pre-loaded a config (CLI's `inspectAction` does
  // this so it can render the rootDir-redirect hint before the scan
  // starts), use it verbatim. Otherwise, run the canonical scan-target
  // resolver: load the on-disk config, honor `rootDir`, and walk
  // into a nested React subproject if the requested directory itself
  // lacks a package.json.
  let scanDirectory: string;
  let userConfig: ReactDoctorConfig | null;
  // Source directory of the config file that supplied `userConfig`,
  // when one was loaded from disk. Drives the resolution base for
  // `config.plugins` entries — relative paths and npm packages
  // resolve from here (the config file's location), NOT from the
  // post-`rootDir` scan root. `null` when the caller passed
  // `configOverride` programmatically without a corresponding
  // `configSourceDirectory`, in which case the runner falls back
  // to the scan root for plugin resolution.
  let configSourceDirectory: string | null;
  if (hasConfigOverride) {
    scanDirectory = directory;
    userConfig = configOverride;
    configSourceDirectory = inputOptions.configSourceDirectory ?? null;
  } else {
    const scanTarget = await resolveScanTarget(directory);
    scanDirectory = scanTarget.resolvedDirectory;
    userConfig = scanTarget.userConfig;
    configSourceDirectory = scanTarget.configSourceDirectory;
  }

  const options = mergeInspectOptions(inputOptions, userConfig);

  // HACK: spinner.ts still has module-level silent state for imperative CLI
  // helpers. Concurrent batch members never touch the shared flag — overlapping
  // save/restore pairs would race — so the pool owner (the CLI) silences
  // spinners once around the whole batch.
  const ownsSpinnerSilence = options.silent && !isConcurrentScan;
  const wasSpinnerSilent = isSpinnerSilent();
  if (ownsSpinnerSilence) setSpinnerSilent(true);

  try {
    const result = await withSentryRunSpan(
      async (rootSentrySpan) => {
        try {
          return await runInspectWithRuntime(
            scanDirectory,
            options,
            userConfig,
            hasConfigOverride,
            configSourceDirectory,
            startTime,
            deadlineEpochMs,
            rootSentrySpan,
            oxlintRuntime,
          );
        } catch (error) {
          // Emit the canonical wide event on the failure path too: the scan threw
          // before finalizing, so there's no `result` — just the error taxonomy
          // plus the config it ran with. The lint/dead-code outcome isn't known
          // here, so it's omitted rather than asserted as a benign default.
          // Rethrow so error handling is unchanged.
          recordRunEvent(rootSentrySpan, {
            ...buildRunEventConfig(options, userConfig, userConfig !== null),
            mode: options.includePaths.length > 0 ? "diff" : "full",
            error,
          });
          throw error;
        }
      },
      { concurrentScan: isConcurrentScan },
    );
    // Scan finished cleanly — clear run-scoped Sentry state so a later non-scan
    // error (inspectAction's finalize/handoff/install steps, or the next
    // project in a workspace loop) isn't mislabeled with this scan's project or
    // mislinked to its already-sent transaction. On a thrown error this line is
    // skipped, so the state persists for the command catch to attribute and
    // link the crash before the process exits. Concurrent batch members never
    // wrote this state, so they have nothing to clear.
    if (!isConcurrentScan) resetSentryRunState();
    return result;
  } finally {
    if (ownsSpinnerSilence) setSpinnerSilent(wasSpinnerSilent);
  }
};

export const createInvocationInspect = (
  requestedOxlintConcurrency?: number,
): ((directory: string, inputOptions?: ReactDoctorInspectOptions) => Promise<InspectResult>) => {
  const concurrency = resolveScanConcurrency(
    requestedOxlintConcurrency ?? Effect.runSync(OxlintConcurrency),
  );
  const spawnSlots = createOxlintSpawnSlots(concurrency);
  const scanResultCacheInvocationState = createScanResultCacheInvocationState();
  return async (directory, inputOptions = {}) => {
    const abortController = new AbortController();
    const unregisterAbortController = activeScanAbortRegistry.register(abortController);
    try {
      const oxlintRuntime: OxlintInvocationRuntime = {
        concurrency,
        spawnSlots,
        abortSignal: abortController.signal,
        scanResultCacheInvocationState,
      };
      return await inspectWithOxlintRuntime(directory, inputOptions, oxlintRuntime);
    } finally {
      unregisterAbortController();
    }
  };
};

export const inspect = async (
  directory: string,
  inputOptions: ReactDoctorInspectOptions = {},
): Promise<InspectResult> =>
  createInvocationInspect(inputOptions.concurrency)(directory, inputOptions);

interface BaselineComparison {
  displayDiagnostics: ReadonlyArray<Diagnostic>;
  baselineDelta: NonNullable<InspectResult["baselineDelta"]>;
}

// Files the lint pass failed to cover — dropped (pathological batches) plus
// deadline-skipped. Distinct from `lintPartialFailures.length`, which also
// counts informational notes (e.g. the react-hooks-js plugin-drop) that leave
// the lint COMPLETE. Baseline comparison is only unreliable when coverage is
// actually incomplete, so it degrades on this count, not on any partial string.
const countIncompleteLintFiles = (lintPartialFailures: ReadonlyArray<string>): number =>
  countDroppedLintFiles(lintPartialFailures) + countDeadlineSkippedFiles(lintPartialFailures);

interface RunBaselineComparisonInput {
  directory: string;
  options: ResolvedInspectOptions;
  userConfig: ReactDoctorConfig | null;
  /**
   * Where `userConfig` was loaded from, so the base scan resolves
   * `config.plugins` specifiers from the real config directory — anchoring
   * them at the temp snapshot (which has no `node_modules` or plugin files)
   * silently drops every custom plugin from the base side and mislabels its
   * pre-existing findings as newly introduced.
   */
  configSourceDirectory: string | null;
  headProjectInfo: ProjectInfo;
  headDiagnostics: ReadonlyArray<Diagnostic>;
  resolvedNodeBinaryPath: string | null;
  baselineRef: string;
  baseFiles?: ReadonlyArray<string>;
  headFiles?: ReadonlyArray<string>;
  headAnalyzedFiles: ReadonlyArray<string>;
  /** Shared invocation deadline; bounds the base-ref lint like the head scan. */
  deadlineEpochMs: number | null;
  oxlintRuntime: OxlintInvocationRuntime;
}

/**
 * Runs a second, lint-only scan over the changed files as they existed at the
 * baseline ref (materialized into a temp tree with head's config) and diffs it
 * against the head diagnostics, returning only the findings the change
 * introduced plus the fixed / base counts. No score, dead-code, progress, or
 * telemetry — it's a pure comparison pass. The temp tree is always cleaned up.
 */
const runBaselineComparison = async (
  params: RunBaselineComparisonInput,
): Promise<BaselineComparison | null> => {
  const tempDirectory = mkdtempSync(path.join(tmpdir(), BASELINE_FILES_TEMP_DIR_PREFIX));
  const baselineIncludePaths = filterPathsOutsideDirectories({
    rootDirectory: params.directory,
    relativePaths: params.options.includePaths,
    excludedDirectories: params.options.excludedProjectDirectories,
  });
  const baselineBaseFiles = params.baseFiles
    ? filterPathsOutsideDirectories({
        rootDirectory: params.directory,
        relativePaths: params.baseFiles,
        excludedDirectories: params.options.excludedProjectDirectories,
      })
    : undefined;
  const baselineHeadFiles = params.headFiles
    ? filterPathsOutsideDirectories({
        rootDirectory: params.directory,
        relativePaths: params.headFiles,
        excludedDirectories: params.options.excludedProjectDirectories,
      })
    : undefined;
  // If materialization throws before the snapshot (and its cleanup) exists,
  // remove the temp dir we just created so it can't leak.
  const snapshot = await materializeBaselineFiles({
    directory: params.directory,
    ref: params.baselineRef,
    files: baselineIncludePaths,
    baseFiles: baselineBaseFiles,
    headFiles: baselineHeadFiles,
    tempDirectory,
  }).catch((error: unknown) => {
    rmSync(tempDirectory, { recursive: true, force: true });
    throw error;
  });
  if (snapshot === null) {
    rmSync(tempDirectory, { recursive: true, force: true });
    return null;
  }
  try {
    if (!snapshot.isComplete) return null;
    const analyzedHeadFiles = new Set(params.headAnalyzedFiles.map(toForwardSlashes));
    const baseFiles = new Set(snapshot.baseFiles.map(toForwardSlashes));
    const trackedHeadFiles = new Set(snapshot.headFiles.map(toForwardSlashes));
    const expectedHeadFiles = new Set(trackedHeadFiles);
    for (const filePath of baselineIncludePaths) {
      const normalizedFilePath = toForwardSlashes(filePath);
      if (!baseFiles.has(normalizedFilePath)) expectedHeadFiles.add(normalizedFilePath);
    }
    if (
      filterSourceFiles([...expectedHeadFiles]).some((filePath) => !analyzedHeadFiles.has(filePath))
    ) {
      return null;
    }
    const baseLayers = buildRuntimeLayers({
      directory: snapshot.tempDirectory,
      hasConfigOverride: true,
      userConfig: params.userConfig,
      configSourceDirectory: params.configSourceDirectory,
      projectInfoOverride: params.headProjectInfo,
      shouldSkipLint: !params.options.lint || !params.resolvedNodeBinaryPath,
      shouldRunDeadCode: false,
      shouldRunSupplyChain: params.options.supplyChain,
      shouldComputeScore: false,
      shouldShowProgressSpinners: false,
      oxlintConcurrency: params.oxlintRuntime.concurrency,
      oxlintSpawnSlots: params.oxlintRuntime.spawnSlots,
    });
    const baseProgram = runInspectEffect(
      {
        directory: snapshot.tempDirectory,
        includePaths: snapshot.materializedFiles,
        customRulesOnly: params.options.customRulesOnly,
        respectInlineDisables: params.options.respectInlineDisables,
        warnings: params.options.warnings,
        adoptExistingLintConfig: params.options.adoptExistingLintConfig,
        ignoredTags: params.options.ignoredTags,
        includedTags: params.options.includedTags,
        includeTagDefaults: params.options.includeTagDefaults,
        nodeBinaryPath: params.resolvedNodeBinaryPath ?? undefined,
        runDeadCode: false,
        isCi: params.options.isCi,
        doctorVersion: VERSION,
        runId: getRunId(),
        resolveLocalGithubViewerPermission: false,
        suppressScanSummary: true,
        // Score the base manifest too so `computeDiagnosticDelta` filters out
        // pre-existing low-score dependencies instead of reporting them as new.
        supplyChainManifestChanged: params.options.supplyChainManifestChanged,
        // The base-ref lint shares the invocation deadline, so a --max-duration
        // budget bounds the whole run, not just the head scan.
        deadlineEpochMs: params.deadlineEpochMs ?? undefined,
        signal: params.oxlintRuntime.abortSignal,
      },
      {},
    );
    const baseOutput = await Effect.runPromise(
      restoreLegacyThrow(
        baseProgram.pipe(
          Effect.provide(baseLayers),
          // The base snapshot lints in a per-run-unique temp dir, so its
          // on-disk cache identity can never hit — writing would only mint an
          // orphan per-run subdir inside the CI-persisted cache directory
          // (unbounded growth across the action's restore→save cycles).
          Effect.provideService(PerFileLintCacheEnabled, false),
          Effect.provideService(SidecarLintCacheEnabled, false),
          Effect.provideService(Console.Console, silentConsole),
        ),
      ),
      { signal: params.oxlintRuntime.abortSignal },
    );
    // A failed OR budget-truncated base lint leaves base findings
    // unreliable/incomplete, which would mislabel pre-existing head issues as
    // newly introduced. Signal "no delta" (null) so the caller degrades to a
    // plain diff — full head findings stay visible, but the run won't claim
    // they're new or gate on them. A genuinely empty but *successful* base lint
    // is fine — every head finding is new.
    if (baseOutput.didLintFail || countIncompleteLintFiles(baseOutput.lintPartialFailures) > 0) {
      return null;
    }
    const hasUnscannedUntrackedSourceFiles = filterSourceFiles(
      snapshot.untrackedFiles.map(toForwardSlashes),
    ).some((filePath) => !analyzedHeadFiles.has(filePath));
    const delta = computeDiagnosticDelta({
      headDiagnostics: params.headDiagnostics,
      baseDiagnostics: baseOutput.diagnostics,
      readHeadLine: createSourceLineReader(params.directory),
      readBaseLine: createSourceLineReader(snapshot.tempDirectory),
      readHeadEvidence: createDiagnosticEvidenceReader(params.directory, {
        resolveForwardedHandlers: true,
      }),
      readBaseEvidence: createDiagnosticEvidenceReader(snapshot.tempDirectory),
    });
    return {
      displayDiagnostics: delta.newDiagnostics,
      baselineDelta: {
        baseRef: params.baselineRef,
        fixedCount: hasUnscannedUntrackedSourceFiles ? 0 : delta.fixedCount,
        baseTotalCount: baseOutput.diagnostics.length,
        crossFileMatchCount: delta.crossFileMatchCount,
      },
    };
  } finally {
    snapshot.cleanup();
  }
};

const runInspectWithRuntime = async (
  directory: string,
  options: ResolvedInspectOptions,
  userConfig: ReactDoctorConfig | null,
  hasConfigOverride: boolean,
  configSourceDirectory: string | null,
  startTime: number,
  deadlineEpochMs: number | null,
  rootSentrySpan: SentryRootSpan,
  oxlintRuntime: OxlintInvocationRuntime,
): Promise<InspectResult> => {
  const isDiffMode = options.includePaths.length > 0;
  // Pre-check oxlint native binding before the orchestrator:
  // `resolveOxlintNode` prints its own warnings / upgrade hints and returns
  // `null` when the binding can't be loaded. In that mode the orchestrator
  // runs with `Linter.layerOf([])` so the rest of the pipeline still happens
  // with `skippedChecks: ["lint"]` surfacing the missed coverage.
  const resolvedNodeBinaryPath = await resolveOxlintNode(
    options.lint,
    options.scoreOnly || options.silent,
  );
  const lintBindingMissing = options.lint && !resolvedNodeBinaryPath;
  await yieldToEventLoop();
  const cacheKey = buildScanResultCacheKey({
    projectDirectory: directory,
    version: VERSION,
    nodeBinaryPath: resolvedNodeBinaryPath,
    options,
    userConfig,
    hasConfigOverride,
    configSourceDirectory,
    invocationState: oxlintRuntime.scanResultCacheInvocationState,
  });
  const scanResultCache = cacheKey === null ? null : createScanResultCache(directory);
  const cachedPayload =
    cacheKey === null || scanResultCache === null ? null : scanResultCache.lookup(cacheKey);
  if (cachedPayload) {
    recordSentryProjectContext(cachedPayload.project, rootSentrySpan, {
      concurrentScan: options.concurrentScan,
    });
    recordCount(METRIC.projectDetected, 1);
    const baselineDegraded =
      Boolean(options.baseline) && isDiffMode && cachedPayload.baselineDelta === undefined;
    const result = await renderAndRecordScan({
      payload: cachedPayload,
      options,
      userConfig,
      hasCustomConfig: userConfig !== null,
      startTime,
      rootSentrySpan,
      scanMode: cachedPayload.baselineDelta ? "baseline" : isDiffMode ? "diff" : "full",
      baselineDegraded,
      wholeRepoCacheHit: true,
    });
    return result;
  }

  // Suppress the orchestrator-owned lint + dead-code spinners when
  // the CLI is in score-only / silent / suppressed-rendering mode (or
  // when lint is skipped entirely) — suppressed-rendering scans run
  // concurrently in multi-project batches, where interleaved spinners
  // would garble the terminal. `Progress.layerNoop` makes the lifecycle
  // a no-op; the rest of the pipeline is unchanged.
  const shouldShowProgressSpinners =
    !options.isCiOrCodingAgentEnvironment &&
    !options.silent &&
    !options.scoreOnly &&
    !options.suppressRendering &&
    options.lint &&
    Boolean(resolvedNodeBinaryPath);

  const layers = buildRuntimeLayers({
    directory,
    hasConfigOverride,
    userConfig,
    configSourceDirectory,
    shouldSkipLint: !options.lint || lintBindingMissing,
    shouldRunDeadCode: options.deadCode,
    shouldRunSupplyChain: options.supplyChain,
    shouldComputeScore: !options.noScore,
    shouldShowProgressSpinners,
    oxlintConcurrency: oxlintRuntime.concurrency,
    oxlintSpawnSlots: oxlintRuntime.spawnSlots,
    reporterLayer: options.uiLayers?.reporter,
    progressLayer: options.uiLayers?.progress,
  });

  const program = runInspectEffect(
    {
      directory,
      precomputedSourceFileCount: options.precomputedSourceFileCount,
      includePaths: options.includePaths,
      customRulesOnly: options.customRulesOnly,
      respectInlineDisables: options.respectInlineDisables,
      warnings: options.warnings,
      adoptExistingLintConfig: options.adoptExistingLintConfig,
      ignoredTags: options.ignoredTags,
      includedTags: options.includedTags,
      includeTagDefaults: options.includeTagDefaults,
      nodeBinaryPath: resolvedNodeBinaryPath ?? undefined,
      runDeadCode: options.deadCode,
      isCi: options.isCi,
      doctorVersion: VERSION,
      runId: getRunId(),
      resolveLocalGithubViewerPermission: !options.noScore,
      suppressScanSummary: options.suppressRendering,
      supplyChainManifestChanged: options.supplyChainManifestChanged,
      deadlineEpochMs: deadlineEpochMs ?? undefined,
      signal: oxlintRuntime.abortSignal,
      excludedProjectDirectories: options.excludedProjectDirectories,
      retainExcludedProjectDeadCodeDiagnostics: options.retainExcludedProjectDeadCodeDiagnostics,
    },
    {
      beforeLint: (projectInfo) =>
        Effect.sync(() => {
          // Attach the discovered project shape to Sentry as early as possible
          // (this hook fires right after project discovery) so crashes, the run
          // transaction, and every subsequent metric carry it. No-op when
          // Sentry/tracing is off.
          recordSentryProjectContext(projectInfo, rootSentrySpan, {
            concurrentScan: options.concurrentScan,
          });
          recordCount(METRIC.projectDetected, 1);
        }),
    },
  );

  // HACK: silent mode swaps the global Console for one whose
  // log / error / warn / info / debug methods are no-ops, so
  // every `yield* Console.log(...)` inside the renderers below
  // becomes a tree-shakeable noop without each call having to
  // check a flag itself. Driven by Effect's built-in Console
  // reference, which is `Context.Reference<Console>` with the
  // default value `globalThis.console`.
  // `applyObservability` installs the tracing backend (user OTLP, else the
  // Sentry tracer bridge when tracing is live, else the no-op native tracer)
  // — see its docs for precedence. The silent toggle only swaps the Console
  // reference, not the tracer, so observability is applied identically in both
  // branches.
  const baseProgram = options.silent
    ? program.pipe(Effect.provide(layers), Effect.provideService(Console.Console, silentConsole))
    : program.pipe(Effect.provide(layers));
  const programWithLayers = applyObservability(baseProgram, rootSentrySpan);
  const output = await Effect.runPromise(restoreLegacyThrow(programWithLayers), {
    signal: oxlintRuntime.abortSignal,
  });

  const didLintFail = lintBindingMissing || output.didLintFail;
  const lintFailureReason = lintBindingMissing
    ? `oxlint native binding not found for Node ${process.version}; expected one matching ${OXLINT_NODE_REQUIREMENT}`
    : output.lintFailureReason;
  // The orchestrator already finalized the lint spinner via the
  // Progress service. Print only the supplementary CLI-side hint
  // (upgrade-Node guidance / failure reason) post-orchestrator. Dispatch
  // on the structured failure kind the runtime carries — never the
  // message text (see AGENTS.md: renderers dispatch on reason, not
  // `message.includes(...)`).
  if (
    !options.scoreOnly &&
    !options.uiLayers &&
    !lintBindingMissing &&
    output.didLintFail &&
    lintFailureReason !== null
  ) {
    if (output.lintFailureReasonKind === "native-binding-missing") {
      Effect.runSync(
        Console.log(
          highlighter.gray(
            `  Upgrade to Node ${OXLINT_NODE_REQUIREMENT} or run: npx -p oxlint@latest react-doctor@latest`,
          ),
        ),
      );
    } else {
      Effect.runSync(Console.error(highlighter.error(lintFailureReason)));
    }
  }

  // Baseline mode: subtract the diagnostics that already existed at the base
  // ref so we surface only what this change introduced. The reported score
  // stays head's.
  // When the delta can't be computed — the head lint failed, or the base lint
  // failed (runBaselineComparison returns null) — degrade to a plain diff: keep
  // the full head findings visible and emit no delta. The CLI then reports
  // `mode: "diff"` and skips the gate rather than hiding real findings or
  // blaming the PR for pre-existing ones.
  let inspectDiagnostics: ReadonlyArray<Diagnostic> = output.diagnostics;
  let baselineDelta: InspectResult["baselineDelta"];
  // A head lint that dropped or deadline-skipped files is incomplete, so the
  // delta would silently miss findings in the unlinted files — degrade to a
  // plain diff exactly like a failed head lint.
  if (
    options.baseline &&
    isDiffMode &&
    !didLintFail &&
    countIncompleteLintFiles(output.lintPartialFailures) === 0
  ) {
    const comparison = await runBaselineComparison({
      directory,
      options,
      userConfig,
      configSourceDirectory,
      headProjectInfo: output.project,
      headDiagnostics: output.diagnostics,
      resolvedNodeBinaryPath,
      baselineRef: options.baseline.ref,
      baseFiles: options.baseline.baseFiles,
      headFiles: options.baseline.headFiles,
      headAnalyzedFiles: output.analyzedFiles,
      deadlineEpochMs,
      oxlintRuntime,
    });
    if (comparison) {
      inspectDiagnostics = comparison.displayDiagnostics;
      baselineDelta = comparison.baselineDelta;
    }
  } else if (options.changedLineRanges !== null && isDiffMode) {
    // `--scope lines`: keep diagnostics whose source spans touch the change.
    // Runs at the same post-lint seam as baseline (the score is already
    // computed on the full head set), so the gate, summary, and inline
    // comments all narrow together.
    const isOnChangedLine = buildChangedLineMatcher(directory, options.changedLineRanges);
    inspectDiagnostics = output.diagnostics.filter(isOnChangedLine);
  }
  // Baseline was requested but no delta was produced (head/base lint failed) —
  // the run degrades to a plain diff and must not gate on the full head set.
  const baselineDegraded = Boolean(options.baseline) && isDiffMode && baselineDelta === undefined;
  // The orchestrator already surface-filters scoring input through
  // `scoreSurface: "score"` and computes the real score in-band, so
  // we just consume `output.score`. `--no-score` opts out before the
  // orchestrator's Score service even runs (via `Score.layerOf(null)`
  // in `buildRuntimeLayers`).
  const score = didLintFail ? null : output.score;

  const payload: CachedScanPayload = {
    diagnostics: inspectDiagnostics,
    score,
    project: output.project,
    userConfig: output.userConfig,
    didLintFail,
    lintFailureReason,
    lintPartialFailures: output.lintPartialFailures,
    didDeadCodeFail: output.didDeadCodeFail,
    deadCodeFailureReason: output.deadCodeFailureReason,
    deadCodeOverlapped: output.deadCodeOverlapped,
    directory: output.resolvedDirectory,
    scannedFileCount: output.scannedFileCount,
    scannedFilePaths: output.scannedFilePaths,
    analyzedFiles: output.analyzedFiles,
    scanElapsedMilliseconds: output.scanElapsedMilliseconds,
    scanConcurrency: output.scanConcurrency,
    baselineDelta,
    lintFailureReasonKind: lintBindingMissing
      ? "native-binding-missing"
      : output.lintFailureReasonKind,
    supplyChainOverlapTimedOut: output.supplyChainOverlapTimedOut,
    securityScanFailed: output.securityScanFailed,
    securityScanFailureReason: output.securityScanFailureReason,
    suppressedRuleCounts: output.suppressedRuleCounts,
  };
  // A degraded baseline (requested but no delta — e.g. a transient base-lint
  // failure) must not be persisted: the cache key includes the baseline ref,
  // so a stored degraded payload would replay at this HEAD/base pair until
  // the commit changes, skipping the gate instead of re-attempting the
  // comparison.
  if (
    cacheKey !== null &&
    scanResultCache !== null &&
    shouldStoreScanPayload(payload) &&
    !baselineDegraded
  ) {
    scanResultCache.store(cacheKey, payload);
  }
  const result = await renderAndRecordScan({
    payload,
    options,
    userConfig,
    hasCustomConfig: userConfig !== null,
    startTime,
    rootSentrySpan,
    scanMode: baselineDelta ? "baseline" : isDiffMode ? "diff" : "full",
    baselineDegraded,
    wholeRepoCacheHit: false,
    lintCacheHitFileCount: output.lintCacheHitFileCount,
    lintCacheTotalFileCount: output.lintCacheTotalFileCount,
    lintSidecarReplayedFileCount: output.lintSidecarReplayedFileCount,
    lintSidecarTotalFileCount: output.lintSidecarTotalFileCount,
    deadCodeCacheHit: output.deadCodeCacheHit,
    deadCodeSummaryCacheHits: output.deadCodeSummaryCacheHits,
    deadCodeSummaryCacheMisses: output.deadCodeSummaryCacheMisses,
  });
  return result;
};

interface FinalizeInput {
  options: ResolvedInspectOptions;
  elapsedMilliseconds: number;
  diagnostics: ReadonlyArray<Diagnostic>;
  score: ScoreResult | null;
  project: InspectResult["project"];
  userConfig: ReactDoctorConfig | null;
  didLintFail: boolean;
  lintFailureReason: string | null;
  lintPartialFailures: ReadonlyArray<string>;
  didDeadCodeFail: boolean;
  deadCodeFailureReason: string | null;
  supplyChainOverlapTimedOut: boolean;
  securityScanFailed: boolean;
  securityScanFailureReason: string | null;
  scannedFileCount: number;
  scannedFilePaths: ReadonlyArray<string>;
  analyzedFiles: ReadonlyArray<string>;
  scanElapsedMilliseconds: number;
  lintCacheHitFileCount: number | null;
  lintCacheTotalFileCount: number | null;
  lintSidecarReplayedFileCount: number | null;
  lintSidecarTotalFileCount: number | null;
  deadCodeCacheHit: boolean | null;
  deadCodeSummaryCacheHits: number | null;
  deadCodeSummaryCacheMisses: number | null;
  baselineDelta: InspectResult["baselineDelta"];
}

interface RenderAndRecordScanInput {
  readonly payload: CachedScanPayload;
  readonly options: ResolvedInspectOptions;
  readonly userConfig: ReactDoctorConfig | null;
  readonly hasCustomConfig: boolean;
  readonly startTime: number;
  readonly rootSentrySpan: SentryRootSpan;
  readonly scanMode: "full" | "diff" | "baseline";
  readonly baselineDegraded: boolean;
  /**
   * `true` only on the whole-repo scan-result replay path (the exact-key
   * `cachedPayload` branch, where no lint / dead-code / score work ran).
   * Required so both call sites state it explicitly — the wide event's
   * `cache.temperature = "turbo"` derives from this flag, never from the
   * execution dims below happening to be null.
   */
  readonly wholeRepoCacheHit: boolean;
  /**
   * Per-file lint cache outcome for THIS scan's lint pass. Threaded outside
   * `CachedScanPayload` on purpose — it's telemetry about the lint that ran in
   * this process, not part of the cacheable result, so a whole-repo cache
   * replay (where no lint ran) correctly leaves it absent.
   */
  readonly lintCacheHitFileCount?: number | null;
  readonly lintCacheTotalFileCount?: number | null;
  /**
   * Sidecar lint cache outcome for THIS scan's lint pass. Threaded outside
   * `CachedScanPayload` for the same reason as the lint cache stats above.
   */
  readonly lintSidecarReplayedFileCount?: number | null;
  readonly lintSidecarTotalFileCount?: number | null;
  /**
   * Dead-code result cache outcome for THIS scan's dead-code pass. Threaded
   * outside `CachedScanPayload` for the same reason as the lint cache stats
   * above: a whole-repo cache replay (where no analysis ran) correctly
   * leaves it absent.
   */
  readonly deadCodeCacheHit?: boolean | null;
  /**
   * deslop's incremental summary-cache outcome for THIS scan's dead-code
   * analysis (files served from cached parse summaries vs freshly parsed).
   * Same outside-the-payload contract as the fields above.
   */
  readonly deadCodeSummaryCacheHits?: number | null;
  readonly deadCodeSummaryCacheMisses?: number | null;
}

const runMaybeSilent = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  silent: boolean,
): Effect.Effect<A, E, R> =>
  silent ? effect.pipe(Effect.provideService(Console.Console, silentConsole)) : effect;

const renderAndRecordScan = async (input: RenderAndRecordScanInput): Promise<InspectResult> => {
  const finalizeInput: FinalizeInput = {
    options: input.options,
    elapsedMilliseconds: performance.now() - input.startTime,
    diagnostics: input.payload.diagnostics,
    score: input.payload.score,
    project: input.payload.project,
    userConfig: input.payload.userConfig,
    didLintFail: input.payload.didLintFail,
    lintFailureReason: input.payload.lintFailureReason,
    lintPartialFailures: input.payload.lintPartialFailures,
    didDeadCodeFail: input.payload.didDeadCodeFail,
    deadCodeFailureReason: input.payload.deadCodeFailureReason,
    supplyChainOverlapTimedOut: input.payload.supplyChainOverlapTimedOut,
    securityScanFailed: input.payload.securityScanFailed ?? false,
    securityScanFailureReason: input.payload.securityScanFailureReason ?? null,
    scannedFileCount: input.payload.scannedFileCount,
    scannedFilePaths: input.payload.scannedFilePaths,
    analyzedFiles: input.payload.analyzedFiles ?? [],
    scanElapsedMilliseconds: input.payload.scanElapsedMilliseconds,
    lintCacheHitFileCount: input.lintCacheHitFileCount ?? null,
    lintCacheTotalFileCount: input.lintCacheTotalFileCount ?? null,
    lintSidecarReplayedFileCount: input.lintSidecarReplayedFileCount ?? null,
    lintSidecarTotalFileCount: input.lintSidecarTotalFileCount ?? null,
    deadCodeCacheHit: input.deadCodeCacheHit ?? null,
    deadCodeSummaryCacheHits: input.deadCodeSummaryCacheHits ?? null,
    deadCodeSummaryCacheMisses: input.deadCodeSummaryCacheMisses ?? null,
    baselineDelta: input.payload.baselineDelta,
  };
  const result = await Effect.runPromise(
    runMaybeSilent(finalizeAndRender(finalizeInput), input.options.silent),
  );
  // The real worker count the scan fanned out to (resolved auto count on the
  // common parallel path, where the caller pinned no `concurrency`). A stale
  // cache hit predating the field falls back to the caller's pin.
  const { workerCount: resolvedWorkerCount, parallel } = resolveWorkerTelemetry(
    input.payload.scanConcurrency,
    input.options.concurrency,
  );
  recordScanMetrics({
    result,
    mode: input.scanMode,
    baselineDegraded: input.baselineDegraded,
    parallel,
    workerCount: resolvedWorkerCount,
    lint: input.options.lint,
    deadCode: input.options.deadCode,
    scoreOnly: input.options.scoreOnly,
    noScore: input.options.noScore,
    didLintFail: input.payload.didLintFail,
    lintFailureReasonKind: input.payload.lintFailureReasonKind,
    didDeadCodeFail: input.payload.didDeadCodeFail,
    userConfig: input.userConfig,
    suppressedRuleCounts: input.payload.suppressedRuleCounts,
  });
  recordRunEvent(input.rootSentrySpan, {
    ...buildRunEventConfig(
      input.options,
      input.userConfig,
      input.hasCustomConfig,
      resolvedWorkerCount,
    ),
    result,
    mode: input.scanMode,
    gateExempt: input.baselineDegraded,
    wholeRepoCacheHit: input.wholeRepoCacheHit,
    didLintFail: input.payload.didLintFail,
    lintFailureReasonKind: input.payload.lintFailureReasonKind,
    lintPartialFailureCount: input.payload.lintPartialFailures.length,
    lintDroppedFileCount: countDroppedLintFiles(input.payload.lintPartialFailures),
    lintDeadlineSkippedFileCount: countDeadlineSkippedFiles(input.payload.lintPartialFailures),
    didDeadCodeFail: input.payload.didDeadCodeFail,
    supplyChainOverlapTimedOut: input.payload.supplyChainOverlapTimedOut,
    securityScanFailed: input.payload.securityScanFailed,
    deadCodeOverlapped: input.payload.deadCodeOverlapped,
    suppressedRuleCounts: input.payload.suppressedRuleCounts,
  });
  return result;
};

const finalizeAndRender = (input: FinalizeInput): Effect.Effect<InspectResult> =>
  Effect.gen(function* () {
    const {
      options,
      elapsedMilliseconds,
      diagnostics,
      score,
      project,
      userConfig,
      didLintFail,
      lintFailureReason,
      lintPartialFailures,
      didDeadCodeFail,
      deadCodeFailureReason,
      supplyChainOverlapTimedOut,
      securityScanFailed,
      securityScanFailureReason,
      scannedFileCount,
      scannedFilePaths,
      analyzedFiles,
      scanElapsedMilliseconds,
      lintCacheHitFileCount,
      lintCacheTotalFileCount,
      lintSidecarReplayedFileCount,
      lintSidecarTotalFileCount,
      deadCodeCacheHit,
      deadCodeSummaryCacheHits,
      deadCodeSummaryCacheMisses,
      baselineDelta,
    } = input;

    const { skippedChecks, skippedCheckReasons } = buildSkippedChecks({
      didLintFail,
      lintFailureReason,
      lintPartialFailures,
      didDeadCodeFail,
      deadCodeFailureReason,
      supplyChainOverlapTimedOut,
      securityScanFailed,
      securityScanFailureReason,
    });
    const hasSkippedChecks = skippedChecks.length > 0;
    const noScoreMessage = buildNoScoreMessage({
      isScoreDisabled: options.noScore,
      isAnalysisIncomplete: hasIncompleteScoreAnalysis(skippedChecks),
      disabledMessage: options.scoreDisabledMessage,
    });

    const buildResult = (): InspectResult => ({
      diagnostics: [...diagnostics],
      score,
      skippedChecks,
      ...(Object.keys(skippedCheckReasons).length > 0 ? { skippedCheckReasons } : {}),
      project,
      elapsedMilliseconds,
      scannedFileCount,
      scannedFilePaths,
      analyzedFiles,
      scanElapsedMilliseconds,
      ...(lintCacheTotalFileCount !== null
        ? { lintCacheHitFileCount, lintCacheTotalFileCount }
        : {}),
      ...(lintSidecarTotalFileCount !== null
        ? { lintSidecarReplayedFileCount, lintSidecarTotalFileCount }
        : {}),
      ...(deadCodeCacheHit !== null ? { deadCodeCacheHit } : {}),
      ...(deadCodeSummaryCacheHits !== null && deadCodeSummaryCacheMisses !== null
        ? { deadCodeSummaryCacheHits, deadCodeSummaryCacheMisses }
        : {}),
      ...(baselineDelta ? { baselineDelta } : {}),
    });

    if (options.suppressRendering) {
      return buildResult();
    }

    const surfaceDiagnostics = filterDiagnosticsForSurface(
      [...diagnostics],
      options.outputSurface,
      userConfig,
    );
    const printedDiagnostics = filterDiagnosticsByCategories(
      surfaceDiagnostics,
      options.categoryFilters,
    );

    if (options.scoreOnly) {
      // The path line goes to stderr so `--score` stdout stays machine-clean.
      if (options.outputDirectory !== null) {
        yield* printDiagnosticsDump(printedDiagnostics, options.outputDirectory, false, "stderr");
      }
      if (score) {
        yield* Console.log(`${score.score}`);
      } else {
        // stderr, so scripts that parse `--score` stdout (expecting a bare
        // number) read an empty stream instead of prose when no score exists.
        yield* Console.error(highlighter.gray(noScoreMessage));
      }
      return buildResult();
    }

    const demotedDiagnosticCount = diagnostics.length - surfaceDiagnostics.length;
    if (options.isNonInteractiveEnvironment && options.outputSurface !== "prComment") {
      yield* printAgentGuidance();
    }

    yield* printHeadlessReport({
      diagnostics: printedDiagnostics,
      elapsedMilliseconds,
      emptyStateMessage: buildEmptyReportMessage({
        categoryFilters: options.categoryFilters,
        demotedDiagnosticCount,
        outputSurface: options.outputSurface,
      }),
      noScoreMessage,
      projectName: project.projectName,
      scannedFileCount,
      scoreResult: hasSkippedChecks ? null : score,
      skippedChecks,
    });

    if (options.outputDirectory !== null || options.verbose) {
      yield* printDiagnosticsDump(printedDiagnostics, options.outputDirectory, options.verbose);
    }
    if (options.categoryFilters.size === 0 && demotedDiagnosticCount > 0) {
      yield* Console.log(
        highlighter.gray(
          `  ${demotedDiagnosticCount} demoted from the ${options.outputSurface} surface (e.g. design cleanup) — run \`npx react-doctor@latest .\` locally for the full list.`,
        ),
      );
      yield* Console.log("");
    }

    yield* printFooter({
      diagnostics: printedDiagnostics,
      scoreResult: score,
      projectName: project.projectName,
      isOffline: options.isCi || !options.share || score === null,
    });

    return buildResult();
  });
