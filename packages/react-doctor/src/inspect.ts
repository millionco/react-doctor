import { performance } from "node:perf_hooks";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import type { ReactDoctorConfig } from "./core/core-configuration.js";
import {
  createOxlintSpawnSlots,
  OxlintConcurrency,
  OXLINT_NODE_REQUIREMENT,
  resolveScanConcurrency,
  runInspect as runInspectEffect,
} from "./core/core-runtime.js";
import { restoreLegacyThrow } from "./core/core-errors.js";
import { highlighter } from "./core/core-presentation.js";
import { resolveScanTarget } from "./core/core-project-discovery.js";
import type { InspectResult } from "./core/core-types.js";
import { applyObservability } from "./cli/utils/apply-observability.js";
import { buildRuntimeLayers } from "./cli/utils/build-runtime-layers.js";
import {
  recordSentryProjectContext,
  resetSentryRunState,
  withSentryRunSpan,
} from "./cli/utils/with-sentry-run-span.js";
import type { SentryRootSpan } from "./cli/utils/with-sentry-run-span.js";
import { METRIC } from "./cli/utils/constants.js";
import { recordCount } from "./cli/utils/record-metric.js";
import { recordRunEvent } from "./cli/utils/build-run-event.js";
import { isCiOrCodingAgentEnvironment } from "./cli/utils/is-ci-environment.js";
import {
  canAnimateOnboarding,
  isOnboardingForced,
  shouldRecordOnboarding,
} from "./cli/utils/onboarding-pacing.js";
import { hasCompletedOnboarding, markOnboardingComplete } from "./cli/utils/onboarding-state.js";
import { isNonInteractiveEnvironment } from "./cli/utils/is-non-interactive-environment.js";
import { printProjectDetection } from "./cli/utils/render-project-detection.js";
import {
  buildRunEventConfig,
  renderAndRecordScan,
  renderCachedProjectDetection,
  silentConsole,
} from "./cli/utils/render-inspect-result.js";
import { resolveOxlintNode } from "./cli/utils/resolve-oxlint-node.js";
import { getRunId } from "./cli/utils/run-id.js";
import type { CachedScanPayload } from "./cli/utils/scan-result-cache.js";
import { createScanResultCacheLifecycle } from "./cli/utils/scan-result-cache-lifecycle.js";
import { resolveInspectOptions } from "./cli/utils/resolve-inspect-options.js";
import { resolveBaselineComparison } from "./cli/utils/resolve-baseline-comparison.js";
import type { OxlintInvocationRuntime } from "./cli/utils/resolve-baseline-comparison.js";
import { isSpinnerSilent, setSpinnerSilent } from "./cli/utils/spinner.js";
import { VERSION } from "./cli/utils/version.js";
import type {
  ReactDoctorInspectOptions,
  ResolvedInspectOptions,
} from "./contracts/inspect-options.js";

export type {
  InspectUiLayers,
  ReactDoctorInspectOptions,
  ResolvedInspectOptions,
} from "./contracts/inspect-options.js";

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

  const options = resolveInspectOptions({
    inputOptions,
    userConfig,
    environment: {
      isCiOrCodingAgentEnvironment: isCiOrCodingAgentEnvironment(),
      isNonInteractiveEnvironment: isNonInteractiveEnvironment(),
    },
  });

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
  const oxlintRuntime: OxlintInvocationRuntime = {
    concurrency,
    spawnSlots: createOxlintSpawnSlots(concurrency),
  };
  return (directory, inputOptions = {}) =>
    inspectWithOxlintRuntime(directory, inputOptions, oxlintRuntime);
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
  rootSentrySpan: SentryRootSpan,
  oxlintRuntime: OxlintInvocationRuntime,
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
  const cacheLifecycle = createScanResultCacheLifecycle({
    directory,
    options,
    userConfig,
    hasConfigOverride,
    configSourceDirectory,
    resolvedNodeBinaryPath,
    startTime,
    rootSentrySpan,
    renderCachedProjectDetection,
    renderAndRecordScan,
    recordOnboardingCompletion,
  });
  const cachedResult = cacheLifecycle.replay();
  if (cachedResult !== null) return await cachedResult;

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
    !options.uiLayers &&
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

  const comparison = await resolveBaselineComparison({
    directory,
    options,
    userConfig,
    configSourceDirectory,
    headProjectInfo: output.project,
    headDiagnostics: output.diagnostics,
    headAnalyzedFiles: output.analyzedFiles,
    didLintFail,
    lintPartialFailures: output.lintPartialFailures,
    resolvedNodeBinaryPath,
    deadlineEpochMs,
    oxlintRuntime,
    silentConsole,
  });
  const inspectDiagnostics = comparison.displayDiagnostics;
  const baselineDelta = comparison.baselineDelta;
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
  return await cacheLifecycle.complete({
    payload,
    scanMode: baselineDelta ? "baseline" : isDiffMode ? "diff" : "full",
    baselineDegraded,
    lintCacheHitFileCount: output.lintCacheHitFileCount,
    lintCacheTotalFileCount: output.lintCacheTotalFileCount,
    lintSidecarReplayedFileCount: output.lintSidecarReplayedFileCount,
    lintSidecarTotalFileCount: output.lintSidecarTotalFileCount,
    deadCodeCacheHit: output.deadCodeCacheHit,
    deadCodeSummaryCacheHits: output.deadCodeSummaryCacheHits,
    deadCodeSummaryCacheMisses: output.deadCodeSummaryCacheMisses,
  });
};
