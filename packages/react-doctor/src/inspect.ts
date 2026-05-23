import { performance } from "node:perf_hooks";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import {
  calculateScore,
  filterDiagnosticsForSurface,
  highlighter,
  loadConfigWithSource,
  OXLINT_NODE_REQUIREMENT,
  ReactDoctorError,
  resolveConfigRootDir,
  runInspect as runInspectEffect,
  type ReactDoctorErrorReason,
} from "@react-doctor/core";
import { buildRuntimeLayers } from "./cli/utils/build-runtime-layers.js";
import {
  AmbiguousProjectError,
  NoReactDependencyError,
  ProjectNotFoundError,
} from "@react-doctor/core";
import type {
  Diagnostic,
  DiagnosticSurface,
  InspectOptions,
  InspectResult,
  ReactDoctorConfig,
  ScoreResult,
} from "@react-doctor/core";
import { printDiagnostics } from "./cli/utils/render-diagnostics.js";
import { printProjectDetection } from "./cli/utils/render-project-detection.js";
import {
  printBrandingOnlyHeader,
  printNoScoreHeader,
  printScoreHeader,
} from "./cli/utils/render-score-header.js";
import { printSummary } from "./cli/utils/render-summary.js";
import { resolveOxlintNode } from "./cli/utils/resolve-oxlint-node.js";
import { isSpinnerSilent, setSpinnerSilent, spinner } from "./cli/utils/spinner.js";

// HACK: console object whose methods are no-ops. Provided via
// `Effect.provideService(Console.Console, silentConsole)` to suppress
// every `Console.log` / `error` / `warn` under `--silent`. Leans on
// Effect's built-in Console reference (`ConsoleRef`, default value
// `globalThis.console`) instead of a parallel logger abstraction.
// `globalThis.console` exposes ~30 methods (count, table, time, …);
// the cast says "this object covers the usage that Effect's Console
// module routes through" without stubbing every one.
const silentConsole = new Proxy({} as Console.Console, {
  get: () => () => undefined,
});

const runConsole = (effect: Effect.Effect<void>): void => {
  Effect.runSync(effect);
};

interface ResolvedInspectOptions {
  lint: boolean;
  deadCode: boolean;
  verbose: boolean;
  scoreOnly: boolean;
  offline: boolean;
  isCi: boolean;
  silent: boolean;
  includePaths: string[];
  customRulesOnly: boolean;
  share: boolean;
  respectInlineDisables: boolean;
  adoptExistingLintConfig: boolean;
  ignoredTags: ReadonlySet<string>;
  outputSurface: DiagnosticSurface;
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
  offline: inputOptions.offline ?? false,
  isCi: inputOptions.isCi ?? false,
  silent: inputOptions.silent ?? false,
  includePaths: inputOptions.includePaths ?? [],
  customRulesOnly: userConfig?.customRulesOnly ?? false,
  share: userConfig?.share ?? true,
  respectInlineDisables:
    inputOptions.respectInlineDisables ?? userConfig?.respectInlineDisables ?? true,
  adoptExistingLintConfig: userConfig?.adoptExistingLintConfig ?? true,
  ignoredTags: buildIgnoredTags(userConfig),
  outputSurface: inputOptions.outputSurface ?? "cli",
});

/**
 * Tagged-reason → legacy-class dispatch for the public `inspect()`
 * contract. Each case converts a `ReactDoctorError` reason into the
 * historical thrown class (`NoReactDependencyError`, …) via
 * `Effect.die`, which `Effect.runPromise` re-throws unchanged.
 * Unmatched reasons (GitInvocationFailed, OxlintSpawnFailed, …)
 * flow through as the original tagged `ReactDoctorError` instance.
 *
 * Adding a new public thrown class is one new entry on this object
 * — no `instanceof` checks, no `switch` ladder. The function form
 * (vs. the standalone constant) is required so `Effect.catchReasons`
 * gets the surrounding Effect's error channel for type inference.
 */
const restoreLegacyThrow = <Value, Requirements>(
  effect: Effect.Effect<Value, ReactDoctorError, Requirements>,
): Effect.Effect<Value, never, Requirements> =>
  effect.pipe(
    Effect.catchReasons(
      "ReactDoctorError",
      {
        NoReactDependency: (reason) => Effect.die(new NoReactDependencyError(reason.directory)),
        ProjectNotFound: (reason) => Effect.die(new ProjectNotFoundError(reason.directory)),
        AmbiguousProject: (reason) =>
          Effect.die(new AmbiguousProjectError(reason.directory, [...reason.candidates])),
      },
      // Legacy contract: any other tagged reason surfaces as a
      // plain `Error` carrying the tagged-class message string, so
      // callers that grep `error.message` continue to work.
      (_reason, error) => Effect.die(new Error(error.message)),
    ),
  );

export const inspect = async (
  directory: string,
  inputOptions: InspectOptions = {},
): Promise<InspectResult> => {
  const startTime = performance.now();

  const hasConfigOverride = inputOptions.configOverride !== undefined;
  let scanDirectory = directory;
  let userConfig: ReactDoctorConfig | null;
  // Source directory of the config file that supplied `userConfig`,
  // when one was loaded from disk. Drives the resolution base for
  // `config.plugins` entries — relative paths and npm packages
  // resolve from here (the config file's location), NOT from the
  // post-`rootDir` scan root. `null` when the caller passed
  // `configOverride` programmatically, in which case the runner
  // falls back to the scan root for plugin resolution.
  let configSourceDirectory: string | null = null;
  if (hasConfigOverride) {
    userConfig = inputOptions.configOverride ?? null;
  } else {
    const loadedConfig = loadConfigWithSource(directory);
    const redirectedDirectory = resolveConfigRootDir(
      loadedConfig?.config ?? null,
      loadedConfig?.sourceDirectory ?? null,
    );
    if (redirectedDirectory) scanDirectory = redirectedDirectory;
    userConfig = loadedConfig?.config ?? null;
    configSourceDirectory = loadedConfig?.sourceDirectory ?? null;
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

interface SpinnerHandle {
  succeed: (text: string) => void;
  fail: (text: string) => void;
}

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

  const layers = buildRuntimeLayers({
    directory,
    hasConfigOverride,
    userConfig,
    configSourceDirectory,
    shouldSkipLint: !options.lint || lintBindingMissing,
    shouldRunDeadCode: options.deadCode,
  });

  const program = Effect.gen(function* () {
    const spinnerRef = yield* Ref.make<SpinnerHandle | null>(null);

    const output = yield* runInspectEffect(
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
      },
      {
        beforeLint: (projectInfo, lintIncludePaths) =>
          Effect.gen(function* () {
            const lintSourceFileCount = lintIncludePaths?.length ?? projectInfo.sourceFileCount;
            if (!options.scoreOnly) {
              yield* printProjectDetection({
                projectInfo,
                userConfig,
                isDiffMode,
                includePaths: options.includePaths,
                lintSourceFileCount,
              });
            }
            if (options.lint && resolvedNodeBinaryPath && !options.scoreOnly && !options.silent) {
              const handle = spinner("Running lint checks...").start();
              yield* Ref.set(spinnerRef, {
                succeed: (text) => handle.succeed(text),
                fail: (text) => handle.fail(text),
              });
            }
          }),
        afterLint: (didFail) =>
          Effect.gen(function* () {
            const handle = yield* Ref.get(spinnerRef);
            if (handle && !didFail) handle.succeed("Running lint checks.");
          }),
      },
    );

    const finalHandle = yield* Ref.get(spinnerRef);
    return { output, finalHandle };
  });

  // HACK: silent mode swaps the global Console for one whose
  // log / error / warn / info / debug methods are no-ops, so
  // every `yield* Console.log(...)` inside the renderers below
  // becomes a tree-shakeable noop without each call having to
  // check a flag itself. Driven by Effect's built-in Console
  // reference, which is `Context.Reference<Console>` with the
  // default value `globalThis.console`.
  const programWithLayers = options.silent
    ? program.pipe(Effect.provide(layers), Effect.provideService(Console.Console, silentConsole))
    : program.pipe(Effect.provide(layers));
  const { output, finalHandle: finalSpinnerHandle } = await Effect.runPromise(
    restoreLegacyThrow(programWithLayers),
  );

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

  if (
    !options.scoreOnly &&
    !lintBindingMissing &&
    output.didLintFail &&
    finalSpinnerHandle !== null &&
    lintFailureReason !== null
  ) {
    if (isNativeBindingFailure && /native binding/.test(lintFailureReason)) {
      finalSpinnerHandle.fail(
        `Lint checks failed — oxlint native binding not found (Node ${process.version}).`,
      );
      runConsole(
        Console.log(
          highlighter.gray(
            `  Upgrade to Node ${OXLINT_NODE_REQUIREMENT} or run: npx -p oxlint@latest react-doctor@latest`,
          ),
        ),
      );
    } else {
      finalSpinnerHandle.fail("Lint checks failed (non-fatal, skipping).");
      runConsole(Console.error(highlighter.error(lintFailureReason)));
    }
  }

  // Dead-code analysis runs inside the runtime stream; surface its
  // outcome to the user as a separate spinner line. Dead-code is
  // sequential after lint in the current pipeline, so showing this
  // only after lint finalizes keeps two ora frame loops from
  // competing for stderr.
  const shouldRenderDeadCodeLine =
    !options.scoreOnly && !options.silent && options.deadCode && !isDiffMode;
  if (shouldRenderDeadCodeLine) {
    const deadCodeSpinner = spinner("Analyzing dead code...").start();
    if (output.didDeadCodeFail) {
      deadCodeSpinner.fail("Dead-code analysis failed (non-fatal, skipping).");
    } else {
      deadCodeSpinner.succeed("Analyzing dead code.");
    }
  }

  // Pre-filter diagnostics through the `score` surface so weak-signal
  // rule families (e.g. `design`) stay out of scoring by default and
  // don't dilute the headline number. The orchestrator's Score
  // service ran with `layerOf(null)` for exactly this reason — it
  // only sees the per-element-filtered list, not the surface-filtered
  // list this function needs. We compute the real score here.
  const inspectDiagnostics: ReadonlyArray<Diagnostic> = output.diagnostics;
  const scoreDiagnostics = filterDiagnosticsForSurface(
    [...inspectDiagnostics],
    "score",
    output.userConfig,
  );
  const score =
    didLintFail || options.offline
      ? null
      : await calculateScore([...scoreDiagnostics], { isCi: options.isCi });

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

    const noScoreMessage = options.offline
      ? "Score unavailable in offline mode."
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

    if (demotedDiagnosticCount > 0) {
      yield* Console.log(
        highlighter.gray(
          `  ${demotedDiagnosticCount} demoted from the ${options.outputSurface} surface (e.g. design cleanup) — run \`npx react-doctor@latest .\` locally for the full list.`,
        ),
      );
      yield* Console.log("");
    }

    const shouldShowShareLink = !options.offline && options.share && !options.isCi;
    yield* printSummary({
      diagnostics: [...surfaceDiagnostics],
      elapsedMilliseconds,
      scoreResult: score,
      projectName: project.projectName,
      totalSourceFileCount: lintSourceFileCount,
      noScoreMessage,
      isOffline: !shouldShowShareLink,
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
