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
  resolveScanTarget,
  restoreLegacyThrow,
  runInspect as runInspectEffect,
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
import type {
  Diagnostic,
  DiagnosticSurface,
  InspectOptions,
  InspectResult,
  ProjectInfo,
  ReactDoctorConfig,
  ScoreResult,
} from "@react-doctor/core";
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
import { printFooter, printSummary } from "./cli/utils/render-summary.js";
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

export interface ReactDoctorInspectOptions extends InspectOptions {
  categoryFilters?: string[];
}

export interface ResolvedInspectOptions {
  lint: boolean;
  deadCode: boolean;
  verbose: boolean;
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
  /** Resolved oxlint worker count, or `undefined` to keep the ambient default. */
  concurrency: number | undefined;
  /** Baseline ref to subtract (new-only mode), or `null` for a plain scan. */
  baseline: { ref: string } | null;
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
  verbose: inputOptions.verbose ?? userConfig?.verbose ?? false,
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
  concurrency: inputOptions.concurrency,
  baseline: inputOptions.baseline ?? null,
});

// The scan-config slice of the wide event, shared by the success and failure
// emit paths (the failure path has no `result`, so it can only supply config).
// The return type is inferred and checked at the call sites, which spread it
// into the full `RunEventInput` — a missing field surfaces there.
const buildRunEventConfig = (
  options: ResolvedInspectOptions,
  userConfig: ReactDoctorConfig | null,
  hasCustomConfig: boolean,
) => ({
  parallel: options.concurrency !== undefined,
  workerCount: options.concurrency,
  lint: options.lint,
  deadCode: options.deadCode,
  scoreOnly: options.scoreOnly,
  noScore: options.noScore,
  respectInlineDisables: options.respectInlineDisables,
  showWarnings: options.warnings,
  ignoredTagCount: options.ignoredTags.size,
  hasCustomConfig,
  userConfig,
});

export const inspect = async (
  directory: string,
  inputOptions: ReactDoctorInspectOptions = {},
): Promise<InspectResult> => {
  const startTime = performance.now();

  // Clear any run-scoped Sentry state from a prior inspect() (workspace scans
  // call this once per project) so a stale project/trace can't leak onto this
  // run's events — including errors thrown before the project is discovered.
  resetSentryRunState();

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
  // `configOverride` programmatically, in which case the runner
  // falls back to the scan root for plugin resolution.
  let configSourceDirectory: string | null;
  if (hasConfigOverride) {
    scanDirectory = directory;
    userConfig = inputOptions.configOverride ?? null;
    configSourceDirectory = null;
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
  // (see `runInspectWithRuntime`).
  const wasSpinnerSilent = isSpinnerSilent();
  if (options.silent) setSpinnerSilent(true);

  try {
    const result = await withSentryRunSpan(async (rootSentrySpan) => {
      try {
        return await runInspectWithRuntime(
          scanDirectory,
          options,
          userConfig,
          hasConfigOverride,
          configSourceDirectory,
          startTime,
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
    });
    // Scan finished cleanly — clear run-scoped Sentry state so a later non-scan
    // error (inspectAction's finalize/handoff/install steps, or the next
    // project in a workspace loop) isn't mislabeled with this scan's project or
    // mislinked to its already-sent transaction. On a thrown error this line is
    // skipped, so the state persists for the command catch to attribute and
    // link the crash before the process exits.
    resetSentryRunState();
    return result;
  } finally {
    if (options.silent) setSpinnerSilent(wasSpinnerSilent);
  }
};

interface BaselineComparison {
  displayDiagnostics: ReadonlyArray<Diagnostic>;
  baselineDelta: NonNullable<InspectResult["baselineDelta"]>;
}

interface RunBaselineComparisonInput {
  directory: string;
  options: ResolvedInspectOptions;
  userConfig: ReactDoctorConfig | null;
  headProjectInfo: ProjectInfo;
  headDiagnostics: ReadonlyArray<Diagnostic>;
  resolvedNodeBinaryPath: string | null;
  baselineRef: string;
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
      configSourceDirectory: null,
      projectInfoOverride: params.headProjectInfo,
      shouldSkipLint: !params.options.lint || !params.resolvedNodeBinaryPath,
      shouldRunDeadCode: false,
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
      },
      {},
    );
    const baseOutput = await Effect.runPromise(
      restoreLegacyThrow(
        baseProgram.pipe(
          Effect.provide(baseLayers),
          Effect.provideService(Console.Console, silentConsole),
        ),
      ),
    );
    // A failed base lint leaves base findings unreliable/empty, which would
    // mislabel pre-existing head issues as newly introduced. Signal "no delta"
    // (null) so the caller degrades to a plain diff — full head findings stay
    // visible, but the run won't claim they're new or gate on them. A genuinely
    // empty but *successful* base lint is fine — every head finding is new.
    if (baseOutput.didLintFail) {
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
    recordSentryProjectContext(cachedPayload.project, rootSentrySpan);
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
    });
    recordOnboardingCompletion(options);
    return result;
  }

  // Suppress the orchestrator-owned lint + dead-code spinners when
  // the CLI is in score-only / silent mode (or when lint is
  // skipped entirely). `Progress.layerNoop` makes the lifecycle a
  // no-op; the rest of the pipeline is unchanged.
  const shouldShowProgressSpinners =
    !options.isCiOrCodingAgentEnvironment &&
    !options.silent &&
    !options.scoreOnly &&
    options.lint &&
    Boolean(resolvedNodeBinaryPath);

  const layers = buildRuntimeLayers({
    directory,
    hasConfigOverride,
    userConfig,
    configSourceDirectory,
    shouldSkipLint: !options.lint || lintBindingMissing,
    shouldRunDeadCode: options.deadCode,
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
    },
    {
      beforeLint: (projectInfo, lintIncludePaths) =>
        Effect.gen(function* () {
          // Attach the discovered project shape to Sentry as early as possible
          // (this hook fires right after project discovery) so crashes, the run
          // transaction, and every subsequent metric carry it. No-op when
          // Sentry/tracing is off.
          recordSentryProjectContext(projectInfo, rootSentrySpan);
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
  if (options.baseline && isDiffMode && !didLintFail) {
    const comparison = await runBaselineComparison({
      directory,
      options,
      userConfig,
      headProjectInfo: output.project,
      headDiagnostics: output.diagnostics,
      resolvedNodeBinaryPath,
      baselineRef: options.baseline.ref,
    });
    if (comparison) {
      inspectDiagnostics = comparison.displayDiagnostics;
      baselineDelta = comparison.baselineDelta;
    }
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
    directory: output.resolvedDirectory,
    scannedFileCount: output.scannedFileCount,
    scannedFilePaths: output.scannedFilePaths,
    scanElapsedMilliseconds: output.scanElapsedMilliseconds,
    baselineDelta,
    lintFailureReasonKind: lintBindingMissing
      ? "native-binding-missing"
      : output.lintFailureReasonKind,
  };
  if (cacheKey !== null && scanResultCache !== null && shouldStoreScanPayload(payload)) {
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
  directory: string;
  scannedFileCount: number;
  scannedFilePaths: ReadonlyArray<string>;
  scanElapsedMilliseconds: number;
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
    directory: input.payload.directory,
    scannedFileCount: input.payload.scannedFileCount,
    scannedFilePaths: input.payload.scannedFilePaths,
    scanElapsedMilliseconds: input.payload.scanElapsedMilliseconds,
    baselineDelta: input.payload.baselineDelta,
  };
  const result = await Effect.runPromise(
    runMaybeSilent(finalizeAndRender(finalizeInput), input.options.silent),
  );
  recordScanMetrics({
    result,
    mode: input.scanMode,
    baselineDegraded: input.baselineDegraded,
    parallel: input.options.concurrency !== undefined,
    workerCount: input.options.concurrency,
    lint: input.options.lint,
    deadCode: input.options.deadCode,
    scoreOnly: input.options.scoreOnly,
    noScore: input.options.noScore,
    didLintFail: input.payload.didLintFail,
    lintFailureReasonKind: input.payload.lintFailureReasonKind,
    didDeadCodeFail: input.payload.didDeadCodeFail,
  });
  recordRunEvent(input.rootSentrySpan, {
    ...buildRunEventConfig(input.options, input.userConfig, input.hasCustomConfig),
    result,
    mode: input.scanMode,
    gateExempt: input.baselineDegraded,
    didLintFail: input.payload.didLintFail,
    lintFailureReasonKind: input.payload.lintFailureReasonKind,
    lintPartialFailureCount: input.payload.lintPartialFailures.length,
    didDeadCodeFail: input.payload.didDeadCodeFail,
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
      directory,
      scannedFileCount,
      scannedFilePaths,
      scanElapsedMilliseconds,
      baselineDelta,
    } = input;

    const { skippedChecks, skippedCheckReasons } = buildSkippedChecks({
      didLintFail,
      lintFailureReason,
      lintPartialFailures,
      didDeadCodeFail,
      deadCodeFailureReason,
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
      scanElapsedMilliseconds,
      ...(baselineDelta ? { baselineDelta } : {}),
    });

    if (options.suppressRendering) {
      return buildResult();
    }

    if (options.scoreOnly) {
      if (score) {
        yield* Console.log(`${score.score}`);
      } else {
        yield* Console.log(highlighter.gray(noScoreMessage));
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

    const surfaceDiagnostics = filterDiagnosticsForSurface(
      [...diagnostics],
      options.outputSurface,
      userConfig,
    );
    const printedDiagnostics = filterDiagnosticsByCategories(
      surfaceDiagnostics,
      options.categoryFilters,
    );
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
