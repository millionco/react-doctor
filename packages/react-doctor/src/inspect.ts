import { performance } from "node:perf_hooks";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import {
  createOxlintSpawnSlots,
  type Diagnostic,
  highlighter,
  type InspectResult,
  OXLINT_NODE_REQUIREMENT,
  OxlintConcurrency,
  type ReactDoctorConfig,
  resolveScanTarget,
  resolveScanConcurrency,
  restoreLegacyThrow,
  runInspect as runInspectEffect,
  yieldToEventLoop,
} from "@react-doctor/core";
import { activeScanAbortRegistry } from "./cli/utils/active-scan-abort-registry.js";
import { applyObservability } from "./cli/utils/apply-observability.js";
import { buildRuntimeLayers } from "./cli/utils/build-runtime-layers.js";
import {
  recordSentryProjectContext,
  resetSentryRunState,
  type RunRootSpan,
  withRunSpan,
} from "./cli/utils/with-run-span.js";
import { METRIC } from "./cli/utils/constants.js";
import { recordCount } from "./cli/utils/record-metric.js";
import { recordRunEvent } from "./cli/utils/build-run-event.js";
import { filterDiagnosticsByChangedLines } from "./cli/utils/filter-diagnostics-by-changed-lines.js";
import { makeNoopConsole } from "./cli/utils/noop-console.js";
import { resolveOxlintNode } from "./cli/utils/resolve-oxlint-node.js";
import { resolveInspectOptions } from "./cli/utils/resolve-inspect-options.js";
import { buildRunEventConfig } from "./cli/utils/render-and-record-scan.js";
import {
  countIncompleteLintFiles,
  runBaselineComparison,
} from "./cli/utils/run-baseline-comparison.js";
import { getRunId } from "./cli/utils/run-id.js";
import { createScanResultCacheInvocationState } from "./cli/utils/scan-result-cache.js";
import { createScanResultCacheLifecycle } from "./cli/utils/scan-result-cache-lifecycle.js";
import type { CachedScanPayload } from "./cli/utils/scan-result-cache-payload.js";
import { isSpinnerSilent, setSpinnerSilent } from "./cli/utils/spinner.js";
import { VERSION } from "./cli/utils/version.js";
import type { ReactDoctorInspectOptions, ResolvedInspectOptions } from "./inspect-options.js";
import type { OxlintInvocationRuntime } from "./inspect-runtime.js";

export type {
  InspectUiLayers,
  ReactDoctorInspectOptions,
  ResolvedInspectOptions,
} from "./inspect-options.js";

const silentConsole = makeNoopConsole();

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

  const options = resolveInspectOptions(inputOptions, userConfig);

  // HACK: spinner.ts still has module-level silent state for imperative CLI
  // helpers. Concurrent batch members never touch the shared flag — overlapping
  // save/restore pairs would race — so the pool owner (the CLI) silences
  // spinners once around the whole batch.
  const ownsSpinnerSilence = options.silent && !isConcurrentScan;
  const wasSpinnerSilent = isSpinnerSilent();
  if (ownsSpinnerSilence) setSpinnerSilent(true);

  try {
    const result = await withRunSpan(
      async (rootSpan) => {
        try {
          return await runInspectWithRuntime(
            scanDirectory,
            options,
            userConfig,
            hasConfigOverride,
            configSourceDirectory,
            startTime,
            deadlineEpochMs,
            rootSpan,
            oxlintRuntime,
          );
        } catch (error) {
          // Emit the canonical wide event on the failure path too: the scan threw
          // before finalizing, so there's no `result` — just the error taxonomy
          // plus the config it ran with. The lint/maintainability outcome isn't known
          // here, so it's omitted rather than asserted as a benign default.
          // Rethrow so error handling is unchanged.
          recordRunEvent(rootSpan, {
            ...buildRunEventConfig(options, userConfig),
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

const runInspectWithRuntime = async (
  directory: string,
  options: ResolvedInspectOptions,
  userConfig: ReactDoctorConfig | null,
  hasConfigOverride: boolean,
  configSourceDirectory: string | null,
  startTime: number,
  deadlineEpochMs: number | null,
  rootSpan: RunRootSpan,
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
  const scanResultCacheLifecycle = createScanResultCacheLifecycle({
    directory,
    options,
    userConfig,
    hasConfigOverride,
    configSourceDirectory,
    resolvedNodeBinaryPath,
    invocationState: oxlintRuntime.scanResultCacheInvocationState,
    startTime,
    rootSpan,
  });
  const cachedResult = scanResultCacheLifecycle.replay();
  if (cachedResult !== null) return cachedResult;

  // Suppress the orchestrator-owned lint + maintainability spinners when
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
      changedLineRanges: options.changedLineRanges ?? undefined,
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
          recordSentryProjectContext(projectInfo, rootSpan, {
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
  // `applyObservability` installs the tracing backend — see its docs. The
  // silent toggle only swaps the Console reference, not the tracer, so
  // observability is applied identically in both branches.
  const baseProgram = options.silent
    ? program.pipe(Effect.provide(layers), Effect.provideService(Console.Console, silentConsole))
    : program.pipe(Effect.provide(layers));
  const programWithLayers = applyObservability(baseProgram, rootSpan);
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
    !output.didDeadCodeFail &&
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
    inspectDiagnostics = filterDiagnosticsByChangedLines({
      directory,
      diagnostics: output.diagnostics,
      changedLineRanges: options.changedLineRanges,
    });
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
  return scanResultCacheLifecycle.complete({
    payload,
    scanMode: baselineDelta ? "baseline" : isDiffMode ? "diff" : "full",
    baselineDegraded,
    cacheStats: {
      lintCacheHitFileCount: output.lintCacheHitFileCount,
      lintCacheTotalFileCount: output.lintCacheTotalFileCount,
      lintSidecarReplayedFileCount: output.lintSidecarReplayedFileCount,
      lintSidecarTotalFileCount: output.lintSidecarTotalFileCount,
      deadCodeCacheHit: output.deadCodeCacheHit,
      deadCodeSummaryCacheHits: output.deadCodeSummaryCacheHits,
      deadCodeSummaryCacheMisses: output.deadCodeSummaryCacheMisses,
    },
  });
};
