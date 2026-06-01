import { performance } from "node:perf_hooks";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import {
  buildSkippedChecks,
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
import { METRIC } from "./cli/utils/constants.js";
import { recordCount } from "./cli/utils/record-metric.js";
import { recordScanMetrics } from "./cli/utils/record-scan-metrics.js";
import type {
  Diagnostic,
  DiagnosticSurface,
  InspectOptions,
  InspectResult,
  ReactDoctorConfig,
  ScoreResult,
} from "@react-doctor/core";
import { makeNoopConsole } from "./cli/utils/noop-console.js";
import { buildNoScoreMessage } from "./cli/utils/build-no-score-message.js";
import { printAgentGuidance } from "./cli/utils/render-agent-guidance.js";
import {
  isCiOrCodingAgentEnvironment,
  isCodingAgentEnvironment,
} from "./cli/utils/is-ci-environment.js";
import { computeProjectedScore } from "./cli/utils/compute-score-projection.js";
import { buildRulePriorityMap } from "./cli/utils/diagnostic-grouping.js";
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
import { isSpinnerSilent, setSpinnerSilent } from "./cli/utils/spinner.js";
import { VERSION } from "./cli/utils/version.js";

const silentConsole = makeNoopConsole();

const runConsole = (effect: Effect.Effect<void>): void => {
  Effect.runSync(effect);
};

interface ResolvedInspectOptions {
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
  adoptExistingLintConfig: boolean;
  ignoredTags: ReadonlySet<string>;
  outputSurface: DiagnosticSurface;
  suppressRendering: boolean;
  /** Resolved oxlint worker count, or `undefined` to keep the ambient default. */
  concurrency: number | undefined;
}

const buildIgnoredTags = (userConfig: ReactDoctorConfig | null): ReadonlySet<string> => {
  const tags = new Set<string>();
  if (userConfig?.ignore?.tags) {
    for (const tag of userConfig.ignore.tags) tags.add(tag);
  }
  return tags;
};

const mergeInspectOptions = (
  inputOptions: InspectOptions,
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
  adoptExistingLintConfig: userConfig?.adoptExistingLintConfig ?? true,
  ignoredTags: buildIgnoredTags(userConfig),
  outputSurface: inputOptions.outputSurface ?? "cli",
  suppressRendering: inputOptions.suppressRendering ?? false,
  concurrency: inputOptions.concurrency,
});

export const inspect = async (
  directory: string,
  inputOptions: InspectOptions = {},
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
    const result = await withSentryRunSpan((rootSentrySpan) =>
      runInspectWithRuntime(
        scanDirectory,
        options,
        userConfig,
        hasConfigOverride,
        configSourceDirectory,
        startTime,
        rootSentrySpan,
      ),
    );
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

  const inspectDiagnostics: ReadonlyArray<Diagnostic> = output.diagnostics;
  // The orchestrator already surface-filters scoring input through
  // `scoreSurface: "score"` and computes the real score in-band, so
  // we just consume `output.score`. `--no-score` opts out before the
  // orchestrator's Score service even runs (via `Score.layerOf(null)`
  // in `buildRuntimeLayers`).
  const score = didLintFail ? null : output.score;

  const elapsedMilliseconds = performance.now() - startTime;
  // Stagger sections only on a user's first interactive run. Gating on
  // `canAnimateOnboarding` (the same predicate the welcome scene, animations,
  // and marker use) keeps the decision single-sourced: we only pace when we can
  // actually show — and thus record — onboarding, so we never insert silent
  // dead sleeps. Nothing to pace for silent/score-only/suppressed/verbose
  // renders; the persisted marker (read last) limits it to the very first run.
  // `REACT_DOCTOR_FORCE_ONBOARDING` replays the first-run experience on demand.
  const forceOnboarding = isOnboardingForced();
  const paceOnboardingSections =
    !options.silent &&
    !options.scoreOnly &&
    !options.suppressRendering &&
    !options.verbose &&
    canAnimateOnboarding(process.stdout) &&
    (forceOnboarding || !hasCompletedOnboarding());
  const finalizeInput: FinalizeInput = {
    options,
    elapsedMilliseconds,
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
  };
  const result = await Effect.runPromise(
    finalizeAndRender(finalizeInput).pipe(
      options.silent ? Effect.provideService(Console.Console, silentConsole) : (program) => program,
    ),
  );
  // Burn the first-run marker only when the onboarding reveal actually ran — not
  // for verbose, the classic non-interactive layout, or a forced demo (which
  // replays every time). See `shouldRecordOnboarding`.
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
  recordScanMetrics({
    result,
    mode: isDiffMode ? "diff" : "full",
    parallel: options.concurrency !== undefined,
    workerCount: options.concurrency,
    lint: options.lint,
    deadCode: options.deadCode,
    scoreOnly: options.scoreOnly,
    noScore: options.noScore,
    didLintFail,
    lintFailureReasonKind: lintBindingMissing
      ? "native-binding-missing"
      : output.lintFailureReasonKind,
    didDeadCodeFail: output.didDeadCodeFail,
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
  directory: string;
  scannedFileCount: number;
  scannedFilePaths: ReadonlyArray<string>;
  scanElapsedMilliseconds: number;
}

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
    const demotedDiagnosticCount = diagnostics.length - surfaceDiagnostics.length;
    const isDiffMode = options.includePaths.length > 0;
    const lintSourceFileCount = isDiffMode ? options.includePaths.length : project.sourceFileCount;

    if (surfaceDiagnostics.length === 0) {
      yield* pause;
      if (hasSkippedChecks) {
        const skippedLabel = skippedChecks.join(" and ");
        yield* Console.warn(
          highlighter.warn(
            `No issues detected, but ${skippedLabel} checks failed — results are incomplete.`,
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
      [...surfaceDiagnostics],
      options.verbose,
      directory,
      buildRulePriorityMap([score]),
      isCodingAgentEnvironment(),
      { sectionPause: pause, animateCountUp: animateRender },
    );
    if (options.isNonInteractiveEnvironment && options.outputSurface !== "prComment") {
      yield* printAgentGuidance();
    }

    if (demotedDiagnosticCount > 0) {
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
          computeProjectedScore([...surfaceDiagnostics], [...surfaceDiagnostics], score),
        )
      : null;

    const shouldShowShareLink = !options.noScore && options.share && !options.isCi;
    yield* pause;
    yield* printSummary({
      diagnostics: [...surfaceDiagnostics],
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
      diagnostics: [...surfaceDiagnostics],
      scoreResult: score,
      projectName: project.projectName,
      isOffline: !shouldShowShareLink,
    });

    return buildResult();
  });
