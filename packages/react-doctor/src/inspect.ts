import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import {
  buildSkippedChecks,
  computeDiagnosticDelta,
  DEFAULT_SHOW_WARNINGS,
  filterDiagnosticsForSurface,
  highlighter,
  OXLINT_NODE_REQUIREMENT,
  PerFileLintCacheEnabled,
  resolveScanTarget,
  restoreLegacyThrow,
  runInspect as runInspectEffect,
  SidecarLintCacheEnabled,
} from "@react-doctor/core";
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
import type {
  ChangedFileLineRanges,
  Diagnostic,
  DiagnosticSurface,
  InspectOptions,
  InspectResult,
  ProjectInfo,
  ReactDoctorConfig,
  ScoreResult,
} from "@react-doctor/core";
import { toForwardSlashes } from "./cli/utils/path-format.js";
import { diagnosticIntersectsLineRanges } from "./cli/utils/diagnostic-intersects-line-ranges.js";
import { makeNoopConsole } from "./cli/utils/noop-console.js";
import { materializeBaselineFiles } from "./cli/utils/materialize-baseline-files.js";
import { createSourceLineReader } from "./cli/utils/read-source-line.js";
import { buildNoScoreMessage } from "./cli/utils/build-no-score-message.js";
import { printAgentGuidance } from "./cli/utils/render-agent-guidance.js";
import {
  isCiOrCodingAgentEnvironment,
  isCodingAgentEnvironment,
} from "./cli/utils/is-ci-environment.js";
import { computeProjectedScore } from "./cli/utils/compute-score-projection.js";
import { buildRulePriorityMap } from "./cli/utils/diagnostic-grouping.js";
import { filterDiagnosticsByCategories } from "./cli/utils/filter-diagnostics-by-categories.js";
import { printDiagnostics } from "./cli/utils/render-diagnostics.js";
import { shouldRenderHyperlinks } from "./cli/utils/should-render-hyperlinks.js";
import { isNonInteractiveEnvironment } from "./cli/utils/is-non-interactive-environment.js";
import {
  canAnimateOnboarding,
  isOnboardingForced,
  onboardingSectionPause,
  shouldRecordOnboarding,
} from "./cli/utils/onboarding-pacing.js";
import { hasCompletedOnboarding, markOnboardingComplete } from "./cli/utils/onboarding-state.js";
import { printProjectDetection } from "./cli/utils/render-project-detection.js";
import {
  printBrandingOnlyHeader,
  printNoScoreHeader,
  printScoreHeader,
} from "./cli/utils/render-score-header.js";
import { printDiagnosticsDump, printFooter, printSummary } from "./cli/utils/render-summary.js";
import { resolveOxlintNode } from "./cli/utils/resolve-oxlint-node.js";
import { resolveCliCategories } from "./cli/utils/resolve-cli-categories.js";
import { getRunId } from "./cli/utils/run-id.js";
import {
  buildScanResultCacheKey,
  createScanResultCache,
  shouldStoreScanPayload,
  type CachedScanPayload,
} from "./cli/utils/scan-result-cache.js";
import { isSpinnerSilent, setSpinnerSilent } from "./cli/utils/spinner.js";
import { VERSION } from "./cli/utils/version.js";

const silentConsole = makeNoopConsole();

const runConsole = (effect: Effect.Effect<void>): void => {
  Effect.runSync(effect);
};

const recordOnboardingCompletion = (options: ResolvedInspectOptions): void => {
  const forceOnboarding = isOnboardingForced();
  const paceOnboardingSections =
    !options.silent &&
    !options.scoreOnly &&
    !options.suppressRendering &&
    !options.verbose &&
    canAnimateOnboarding(process.stdout) &&
    (forceOnboarding || !hasCompletedOnboarding());
  if (
    shouldRecordOnboarding({
      paceOnboardingSections,
      forceOnboarding,
      verbose: options.verbose,
      isNonInteractiveEnvironment: options.isNonInteractiveEnvironment,
    })
  ) {
    markOnboardingComplete();
  }
};

const formatCategorySelection = (categoryFilters: ReadonlySet<string>): string =>
  [...categoryFilters].join(", ");

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

export interface ReactDoctorInspectOptions extends InspectOptions {
  categoryFilters?: string[];
  /**
   * Internal: an absolute epoch-ms deadline shared across a workspace scan's
   * projects. The CLI sets it so every project honors ONE `--max-duration`
   * budget without restarting it per project, while `maxDurationMs` stays the
   * user's configured value (so telemetry reports what they set). When unset,
   * the deadline is derived from `maxDurationMs` at call start.
   */
  deadlineEpochMs?: number;
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
  outputSurface: DiagnosticSurface;
  suppressRendering: boolean;
  /** See `InspectOptions.concurrentScan`. */
  concurrentScan: boolean;
  /** Resolved oxlint worker count, or `undefined` to keep the ambient default. */
  concurrency: number | undefined;
  /** Scan time budget in milliseconds, or `null` for no budget. */
  maxDurationMs: number | null;
  /** Baseline ref to subtract (new-only mode), or `null` for a plain scan. */
  baseline: { ref: string } | null;
  /**
   * `--scope lines`: changed line ranges to restrict reported diagnostics to,
   * or `null` for any other scope. An empty array still filters (a `lines`
   * scope whose files added no lines reports nothing).
   */
  changedLineRanges: ReadonlyArray<ChangedFileLineRanges> | null;
  /** See `InspectOptions.supplyChainManifestChanged`. */
  supplyChainManifestChanged: boolean;
}

const buildIgnoredTags = (userConfig: ReactDoctorConfig | null): ReadonlySet<string> => {
  const tags = new Set<string>();
  if (userConfig?.ignore?.tags) {
    for (const tag of userConfig.ignore.tags) tags.add(tag);
  }
  return tags;
};

const mergeInspectOptions = (
  inputOptions: ReactDoctorInspectOptions,
  userConfig: ReactDoctorConfig | null,
): ResolvedInspectOptions => ({
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
  customRulesOnly: userConfig?.customRulesOnly ?? false,
  share: userConfig?.share ?? true,
  respectInlineDisables:
    inputOptions.respectInlineDisables ?? userConfig?.respectInlineDisables ?? true,
  warnings: inputOptions.warnings ?? userConfig?.warnings ?? DEFAULT_SHOW_WARNINGS,
  categoryFilters: new Set(resolveCliCategories(inputOptions.categoryFilters) ?? []),
  adoptExistingLintConfig: userConfig?.adoptExistingLintConfig ?? true,
  ignoredTags: buildIgnoredTags(userConfig),
  outputSurface: inputOptions.outputSurface ?? "cli",
  suppressRendering: inputOptions.suppressRendering ?? false,
  concurrentScan: inputOptions.concurrentScan ?? false,
  concurrency: inputOptions.concurrency,
  maxDurationMs: inputOptions.maxDurationMs ?? null,
  baseline: inputOptions.baseline ?? null,
  changedLineRanges: inputOptions.changedLineRanges ?? null,
  supplyChainManifestChanged: inputOptions.supplyChainManifestChanged ?? false,
});

// The scan-config slice of the wide event, shared by the success and failure
// emit paths (the failure path has no `result`, so it can only supply config).
// The return type is inferred and checked at the call sites, which spread it
// into the full `RunEventInput` — a missing field surfaces there.
// Reconstruct the resolved scope from the engine inputs (the CLI resolved it
// from `--scope`, but `inspect()` only sees its effects): a baseline ref means
// `changed`, line ranges mean `lines`, any other diff means `files`, else `full`.
// A degraded `lines` / `changed` run carries neither, so it reads as `files` —
// matching what actually ran.
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

export const inspect = async (
  directory: string,
  inputOptions: ReactDoctorInspectOptions = {},
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

  const hasConfigOverride = inputOptions.configOverride !== undefined;
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
    userConfig = inputOptions.configOverride ?? null;
    configSourceDirectory = inputOptions.configSourceDirectory ?? null;
  } else {
    const scanTarget = await resolveScanTarget(directory);
    scanDirectory = scanTarget.resolvedDirectory;
    userConfig = scanTarget.userConfig;
    configSourceDirectory = scanTarget.configSourceDirectory;
  }

  const options = mergeInspectOptions(inputOptions, userConfig);

  // HACK: spinner.ts still has module-level silent state (used by
  // printProjectDetection's internal spinner() calls). Mirror the
  // silent flag here until that file moves to a Progress service in
  // a follow-up PR. Console-side silent is handled by swapping the
  // global Console reference for `silentConsole` inside the program
  // (see `runInspectWithRuntime`). Concurrent batch members never touch
  // the shared flag — overlapping save/restore pairs would race — so the
  // pool owner (the CLI) silences spinners once around the whole batch.
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
  /** Shared invocation deadline; bounds the base-ref lint like the head scan. */
  deadlineEpochMs: number | null;
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
  // If materialization throws before the snapshot (and its cleanup) exists,
  // remove the temp dir we just created so it can't leak.
  const snapshot = await materializeBaselineFiles({
    directory: params.directory,
    ref: params.baselineRef,
    files: params.options.includePaths,
    tempDirectory,
  }).catch((error: unknown) => {
    rmSync(tempDirectory, { recursive: true, force: true });
    throw error;
  });
  try {
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
      oxlintConcurrency: params.options.concurrency,
    });
    const baseProgram = runInspectEffect(
      {
        directory: snapshot.tempDirectory,
        includePaths: params.options.includePaths,
        customRulesOnly: params.options.customRulesOnly,
        respectInlineDisables: params.options.respectInlineDisables,
        warnings: params.options.warnings,
        adoptExistingLintConfig: params.options.adoptExistingLintConfig,
        ignoredTags: params.options.ignoredTags,
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
    const delta = computeDiagnosticDelta({
      headDiagnostics: params.headDiagnostics,
      baseDiagnostics: baseOutput.diagnostics,
      readHeadLine: createSourceLineReader(params.directory),
      readBaseLine: createSourceLineReader(snapshot.tempDirectory),
    });
    return {
      displayDiagnostics: delta.newDiagnostics,
      baselineDelta: {
        baseRef: params.baselineRef,
        fixedCount: delta.fixedCount,
        baseTotalCount: baseOutput.diagnostics.length,
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
): Promise<InspectResult> => {
  const isDiffMode = options.includePaths.length > 0;
  // Pre-check oxlint native binding the same way the legacy entry
  // point did: `resolveOxlintNode` prints its own warnings / upgrade
  // hints and returns `null` when the binding can't be loaded. In
  // that mode the orchestrator runs with `Linter.layerOf([])` so the
  // rest of the pipeline (project detection, score, rendering) still
  // happens with `skippedChecks: ["lint"]` surfacing the missed
  // coverage.
  const resolvedNodeBinaryPath = await resolveOxlintNode(
    options.lint,
    options.scoreOnly || options.silent,
  );
  const lintBindingMissing = options.lint && !resolvedNodeBinaryPath;
  const cacheKey = buildScanResultCacheKey({
    projectDirectory: directory,
    version: VERSION,
    nodeBinaryPath: resolvedNodeBinaryPath,
    options,
    userConfig,
    hasConfigOverride,
    configSourceDirectory,
  });
  const scanResultCache = cacheKey === null ? null : createScanResultCache(directory);
  const cachedPayload = cacheKey === null ? null : (scanResultCache?.lookup(cacheKey) ?? null);
  if (cachedPayload) {
    recordSentryProjectContext(cachedPayload.project, rootSentrySpan, {
      concurrentScan: options.concurrentScan,
    });
    recordCount(METRIC.projectDetected, 1);
    await renderCachedProjectDetection({
      payload: cachedPayload,
      options,
      userConfig,
      isDiffMode,
    });
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
    recordOnboardingCompletion(options);
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
    oxlintConcurrency: options.concurrency,
  });

  const program = runInspectEffect(
    {
      directory,
      includePaths: options.includePaths,
      customRulesOnly: options.customRulesOnly,
      respectInlineDisables: options.respectInlineDisables,
      warnings: options.warnings,
      adoptExistingLintConfig: options.adoptExistingLintConfig,
      ignoredTags: options.ignoredTags,
      nodeBinaryPath: resolvedNodeBinaryPath ?? undefined,
      runDeadCode: options.deadCode,
      isCi: options.isCi,
      doctorVersion: VERSION,
      runId: getRunId(),
      resolveLocalGithubViewerPermission: !options.noScore,
      suppressScanSummary: options.suppressRendering,
      supplyChainManifestChanged: options.supplyChainManifestChanged,
      concurrentScan: options.concurrentScan,
      deadlineEpochMs: deadlineEpochMs ?? undefined,
    },
    {
      beforeLint: (projectInfo, lintIncludePaths) =>
        Effect.gen(function* () {
          // Attach the discovered project shape to Sentry as early as possible
          // (this hook fires right after project discovery) so crashes, the run
          // transaction, and every subsequent metric carry it. No-op when
          // Sentry/tracing is off.
          recordSentryProjectContext(projectInfo, rootSentrySpan, {
            concurrentScan: options.concurrentScan,
          });
          recordCount(METRIC.projectDetected, 1);
          if (options.scoreOnly || options.suppressRendering) return;
          const lintSourceFileCount = lintIncludePaths?.length ?? projectInfo.sourceFileCount;
          yield* printProjectDetection({
            projectInfo,
            userConfig,
            isDiffMode,
            includePaths: options.includePaths,
            lintSourceFileCount,
          });
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
  const output = await Effect.runPromise(restoreLegacyThrow(programWithLayers));

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
    !lintBindingMissing &&
    output.didLintFail &&
    lintFailureReason !== null
  ) {
    if (output.lintFailureReasonKind === "native-binding-missing") {
      runConsole(
        Console.log(
          highlighter.gray(
            `  Upgrade to Node ${OXLINT_NODE_REQUIREMENT} or run: npx -p oxlint@latest react-doctor@latest`,
          ),
        ),
      );
    } else {
      runConsole(Console.error(highlighter.error(lintFailureReason)));
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
      deadlineEpochMs,
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
  recordOnboardingCompletion(options);
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
  directory: string;
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

interface RenderCachedProjectDetectionInput {
  readonly payload: CachedScanPayload;
  readonly options: ResolvedInspectOptions;
  readonly userConfig: ReactDoctorConfig | null;
  readonly isDiffMode: boolean;
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

const renderCachedProjectDetection = async (
  input: RenderCachedProjectDetectionInput,
): Promise<void> => {
  if (input.options.scoreOnly || input.options.suppressRendering) return;
  await Effect.runPromise(
    runMaybeSilent(
      printProjectDetection({
        projectInfo: input.payload.project,
        userConfig: input.userConfig,
        isDiffMode: input.isDiffMode,
        includePaths: input.options.includePaths,
        lintSourceFileCount: input.payload.scannedFileCount,
      }),
      input.options.silent,
    ),
  );
};

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
    directory: input.payload.directory,
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
      directory,
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
    });
    const hasSkippedChecks = skippedChecks.length > 0;

    const noScoreMessage = buildNoScoreMessage(options.noScore);

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

    // Report animations — the staggered section reveal, the category count-up,
    // and the eased score-projection "ghost gain" — play on every interactive
    // render, like the animated score bar, not just the first-run onboarding.
    // `!silent` keeps the raw cursor writes out of JSON / piped output.
    const animateRender =
      !options.silent && !options.verbose && canAnimateOnboarding(process.stdout);
    const pause = onboardingSectionPause(animateRender);
    const useHyperlinks = shouldRenderHyperlinks(process.stdout);
    const demotedDiagnosticCount = diagnostics.length - surfaceDiagnostics.length;
    const isDiffMode = options.includePaths.length > 0;
    const lintSourceFileCount = isDiffMode ? options.includePaths.length : project.sourceFileCount;

    if (printedDiagnostics.length === 0) {
      yield* pause;
      if (hasSkippedChecks) {
        const skippedLabel = skippedChecks.join(" and ");
        yield* Console.warn(
          highlighter.warn(
            `No issues detected, but ${skippedLabel} checks failed — results are incomplete.`,
          ),
        );
      } else if (options.categoryFilters.size > 0) {
        yield* Console.log(
          highlighter.success(
            `No issues found in category ${formatCategorySelection(options.categoryFilters)}!`,
          ),
        );
      } else if (demotedDiagnosticCount > 0) {
        yield* Console.log(
          highlighter.success(
            `No issues found! (${demotedDiagnosticCount} demoted from the ${options.outputSurface} surface — see config.surfaces.)`,
          ),
        );
      } else {
        yield* Console.log(highlighter.success("No issues found!"));
      }
      yield* Console.log("");
      yield* pause;
      if (hasSkippedChecks) {
        yield* printBrandingOnlyHeader;
        yield* Console.log(highlighter.gray("  Score not shown — some checks could not complete."));
      } else if (score) {
        yield* printScoreHeader(score);
      } else {
        yield* printNoScoreHeader(noScoreMessage);
      }
      // `--output-dir` still gets its dump (and stale-file cleanup) when
      // nothing printed — e.g. every issue was fixed since the last run.
      if (options.outputDirectory !== null) {
        yield* printDiagnosticsDump(printedDiagnostics, options.outputDirectory);
      }
      return buildResult();
    }

    yield* pause;
    yield* Console.log("");
    yield* printDiagnostics(
      [...printedDiagnostics],
      options.verbose,
      directory,
      buildRulePriorityMap([score]),
      isCodingAgentEnvironment(),
      { sectionPause: pause, animateCountUp: animateRender },
      useHyperlinks,
    );
    if (options.isNonInteractiveEnvironment && options.outputSurface !== "prComment") {
      yield* printAgentGuidance();
    }

    if (options.categoryFilters.size === 0 && demotedDiagnosticCount > 0) {
      yield* Console.log(
        highlighter.gray(
          `  ${demotedDiagnosticCount} demoted from the ${options.outputSurface} surface (e.g. design cleanup) — run \`npx react-doctor@latest .\` locally for the full list.`,
        ),
      );
      yield* Console.log("");
    }

    // Re-score with the displayed top errors removed so the score bar can
    // show the payoff as a ghost gain segment.
    const potentialScore = score
      ? yield* Effect.promise(() =>
          computeProjectedScore([...printedDiagnostics], [...surfaceDiagnostics], score),
        )
      : null;

    const shouldShowShareLink = !options.noScore && options.share && !options.isCi;
    yield* pause;
    yield* printSummary({
      diagnostics: [...printedDiagnostics],
      elapsedMilliseconds,
      scoreResult: score,
      potentialScore,
      totalSourceFileCount: lintSourceFileCount,
      noScoreMessage,
      verbose: options.verbose,
      outputDirectory: options.outputDirectory,
      animateProjection: animateRender,
    });

    if (hasSkippedChecks) {
      const skippedLabel = skippedChecks.join(" and ");
      yield* Console.log("");
      yield* Console.warn(
        highlighter.warn(`  Note: ${skippedLabel} checks failed — score may be incomplete.`),
      );
    }

    yield* pause;
    yield* printFooter({
      diagnostics: [...printedDiagnostics],
      scoreResult: score,
      projectName: project.projectName,
      isOffline: !shouldShowShareLink,
    });

    return buildResult();
  });
