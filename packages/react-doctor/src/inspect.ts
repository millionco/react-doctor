import { performance } from "node:perf_hooks";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import {
  filterDiagnosticsForSurface,
  highlighter,
  layerOtlp,
  OXLINT_NODE_REQUIREMENT,
  resolveScanTarget,
  restoreLegacyThrow,
  runInspect as runInspectEffect,
  type ReactDoctorErrorReason,
} from "@react-doctor/core";
import { buildRuntimeLayers } from "./cli/utils/build-runtime-layers.js";
import type {
  Diagnostic,
  DiagnosticSurface,
  InspectOptions,
  InspectResult,
  ReactDoctorConfig,
  ScoreResult,
} from "@react-doctor/core";
import { makeNoopConsole } from "./cli/utils/noop-console.js";
import { printAgentGuidance } from "./cli/utils/render-agent-guidance.js";
import { isCiOrCodingAgentEnvironment } from "./cli/utils/is-ci-environment.js";
import { printDiagnostics } from "./cli/utils/render-diagnostics.js";
import { isNonInteractiveEnvironment } from "./cli/utils/is-non-interactive-environment.js";
import { printProjectDetection } from "./cli/utils/render-project-detection.js";
import {
  printBrandingOnlyHeader,
  printNoScoreHeader,
  printScoreHeader,
} from "./cli/utils/render-score-header.js";
import { printSummary } from "./cli/utils/render-summary.js";
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
  adoptExistingLintConfig: boolean;
  ignoredTags: ReadonlySet<string>;
  outputSurface: DiagnosticSurface;
  suppressRendering: boolean;
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
  adoptExistingLintConfig: userConfig?.adoptExistingLintConfig ?? true,
  ignoredTags: buildIgnoredTags(userConfig),
  outputSurface: inputOptions.outputSurface ?? "cli",
  suppressRendering: inputOptions.suppressRendering ?? false,
});

export const inspect = async (
  directory: string,
  inputOptions: InspectOptions = {},
): Promise<InspectResult> => {
  const startTime = performance.now();

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
    const scanTarget = resolveScanTarget(directory);
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
    return await runInspectWithRuntime(
      scanDirectory,
      options,
      userConfig,
      hasConfigOverride,
      configSourceDirectory,
      startTime,
    );
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
  });

  const program = runInspectEffect(
    {
      directory,
      includePaths: options.includePaths,
      customRulesOnly: options.customRulesOnly,
      respectInlineDisables: options.respectInlineDisables,
      adoptExistingLintConfig: options.adoptExistingLintConfig,
      ignoredTags: options.ignoredTags,
      nodeBinaryPath: resolvedNodeBinaryPath ?? undefined,
      runDeadCode: options.deadCode,
      isCi: options.isCi,
      doctorVersion: VERSION,
      resolveLocalGithubViewerPermission: !options.noScore,
    },
    {
      beforeLint: (projectInfo, lintIncludePaths) =>
        Effect.gen(function* () {
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
  // Otlp layer is a no-op unless REACT_DOCTOR_OTLP_ENDPOINT /
  // REACT_DOCTOR_OTLP_AUTH_HEADER are set, so we always provide it
  // regardless of `options.silent` — the silent toggle only swaps
  // the Console reference, not the tracer.
  const programWithLayers = options.silent
    ? program.pipe(
        Effect.provide(layers),
        Effect.provideService(Console.Console, silentConsole),
        Effect.provide(layerOtlp),
      )
    : program.pipe(Effect.provide(layers), Effect.provide(layerOtlp));
  const output = await Effect.runPromise(restoreLegacyThrow(programWithLayers));

  const didLintFail = lintBindingMissing || output.didLintFail;
  const lintFailureReason = lintBindingMissing
    ? `oxlint native binding not found for Node ${process.version}; expected one matching ${OXLINT_NODE_REQUIREMENT}`
    : output.lintFailureReason;
  // Tagged-reason dispatch beats string sniffing on lintFailureReason
  // — the runtime carries lintFailureReasonTag exactly so this
  // renderer doesn't have to know the format strings the runner
  // produces.
  const lintFailureReasonTag: ReactDoctorErrorReason["_tag"] | null = output.lintFailureReasonTag;
  const isNativeBindingFailure =
    lintFailureReasonTag === "OxlintUnavailable" || lintFailureReasonTag === "OxlintSpawnFailed";

  // The orchestrator already finalized the lint spinner via the
  // Progress service. Print only the supplementary CLI-side hint
  // (upgrade-Node guidance / failure reason) post-orchestrator.
  if (
    !options.scoreOnly &&
    !lintBindingMissing &&
    output.didLintFail &&
    lintFailureReason !== null
  ) {
    if (isNativeBindingFailure && /native binding/.test(lintFailureReason)) {
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
  };
  const result = await Effect.runPromise(
    finalizeAndRender(finalizeInput).pipe(
      options.silent ? Effect.provideService(Console.Console, silentConsole) : (program) => program,
    ),
  );
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
    } = input;

    const skippedChecks: string[] = [];
    if (didLintFail) skippedChecks.push("lint");
    if (didDeadCodeFail) skippedChecks.push("dead-code");
    const hasSkippedChecks = skippedChecks.length > 0;

    const noScoreMessage = options.noScore
      ? "Score disabled by --no-score."
      : "Score unavailable (could not reach the score API).";

    const skippedCheckReasons: Record<string, string> = {};
    if (didLintFail && lintFailureReason !== null) {
      skippedCheckReasons.lint = lintFailureReason;
    } else if (lintPartialFailures.length > 0) {
      skippedCheckReasons["lint:partial"] = lintPartialFailures.join("; ");
    }
    if (didDeadCodeFail && deadCodeFailureReason !== null) {
      skippedCheckReasons["dead-code"] = deadCodeFailureReason;
    }

    const buildResult = (): InspectResult => ({
      diagnostics: [...diagnostics],
      score,
      skippedChecks,
      ...(Object.keys(skippedCheckReasons).length > 0 ? { skippedCheckReasons } : {}),
      project,
      elapsedMilliseconds,
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

    const surfaceDiagnostics = filterDiagnosticsForSurface(
      [...diagnostics],
      options.outputSurface,
      userConfig,
    );
    const demotedDiagnosticCount = diagnostics.length - surfaceDiagnostics.length;
    const isDiffMode = options.includePaths.length > 0;
    const lintSourceFileCount = isDiffMode ? options.includePaths.length : project.sourceFileCount;

    if (surfaceDiagnostics.length === 0) {
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

    yield* Console.log("");
    yield* printDiagnostics([...surfaceDiagnostics], options.verbose, directory);
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

    const shouldShowShareLink = !options.noScore && options.share && !options.isCi;
    yield* printSummary({
      diagnostics: [...surfaceDiagnostics],
      elapsedMilliseconds,
      scoreResult: score,
      projectName: project.projectName,
      totalSourceFileCount: lintSourceFileCount,
      noScoreMessage,
      isOffline: !shouldShowShareLink,
      verbose: options.verbose,
    });

    if (hasSkippedChecks) {
      const skippedLabel = skippedChecks.join(" and ");
      yield* Console.log("");
      yield* Console.warn(
        highlighter.warn(`  Note: ${skippedLabel} checks failed — score may be incomplete.`),
      );
    }

    return buildResult();
  });
