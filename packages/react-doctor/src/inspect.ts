import { performance } from "node:perf_hooks";
import {
  OXLINT_NODE_REQUIREMENT,
  calculateScore,
  checkDeadCode,
  combineDiagnostics,
  computeJsxIncludePaths,
  filterDiagnosticsForSurface,
  formatErrorChain,
  highlighter,
  isLoggerSilent,
  loadConfigWithSource,
  logger,
  resolveConfigRootDir,
  resolveLintIncludePaths,
  runOxlint,
  setLoggerSilent,
} from "@react-doctor/core";
import { discoverProject, NoReactDependencyError } from "@react-doctor/project-info";
import type {
  Diagnostic,
  DiagnosticSurface,
  InspectOptions,
  InspectResult,
  ReactDoctorConfig,
} from "@react-doctor/types";
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

interface ResolvedInspectOptions {
  lint: boolean;
  deadCode: boolean;
  verbose: boolean;
  scoreOnly: boolean;
  offline: boolean;
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

export const inspect = async (
  directory: string,
  inputOptions: InspectOptions = {},
): Promise<InspectResult> => {
  const startTime = performance.now();

  let scanDirectory = directory;
  let userConfig: ReactDoctorConfig | null;
  if (inputOptions.configOverride !== undefined) {
    userConfig = inputOptions.configOverride;
  } else {
    const loadedConfig = loadConfigWithSource(directory);
    const redirectedDirectory = resolveConfigRootDir(
      loadedConfig?.config ?? null,
      loadedConfig?.sourceDirectory ?? null,
    );
    if (redirectedDirectory) scanDirectory = redirectedDirectory;
    userConfig = loadedConfig?.config ?? null;
  }

  const options = mergeInspectOptions(inputOptions, userConfig);

  const wasLoggerSilent = isLoggerSilent();
  const wasSpinnerSilent = isSpinnerSilent();
  if (options.silent) {
    setLoggerSilent(true);
    setSpinnerSilent(true);
  }

  try {
    return await runInspect(scanDirectory, options, userConfig, startTime);
  } finally {
    if (options.silent) {
      setLoggerSilent(wasLoggerSilent);
      setSpinnerSilent(wasSpinnerSilent);
    }
  }
};

const runInspect = async (
  directory: string,
  options: ResolvedInspectOptions,
  userConfig: ReactDoctorConfig | null,
  startTime: number,
): Promise<InspectResult> => {
  const projectInfo = discoverProject(directory);
  const { includePaths } = options;
  const isDiffMode = includePaths.length > 0;

  if (!projectInfo.reactVersion) {
    throw new NoReactDependencyError(directory);
  }

  const jsxIncludePaths = computeJsxIncludePaths(includePaths);
  const lintIncludePaths = jsxIncludePaths ?? resolveLintIncludePaths(directory, userConfig);
  const lintSourceFileCount = lintIncludePaths?.length ?? projectInfo.sourceFileCount;

  if (!options.scoreOnly) {
    printProjectDetection(projectInfo, userConfig, isDiffMode, includePaths, lintSourceFileCount);
  }

  let didLintFail = false;
  let lintFailureReason: string | null = null;
  const lintPartialFailures: string[] = [];

  let didDeadCodeFail = false;
  let deadCodeFailureReason: string | null = null;

  // Dead-code reachability is a whole-project property — skip in
  // diff / staged mode, matching how `checkReducedMotion` is gated
  // in `combineDiagnostics`.
  const shouldRunDeadCode = options.deadCode && !isDiffMode;

  const resolvedNodeBinaryPath = await resolveOxlintNode(
    options.lint,
    options.scoreOnly || options.silent,
  );
  if (options.lint && !resolvedNodeBinaryPath) {
    didLintFail = true;
    lintFailureReason = `oxlint native binding not found for Node ${process.version}; expected one matching ${OXLINT_NODE_REQUIREMENT}`;
  }

  // Kick off dead-code analysis in parallel with lint, but defer its
  // spinner until the lint spinner finalizes — each `spinner()` call
  // returns its own ora instance, so two concurrent starts would have
  // both frame loops writing to stderr and produce garbled output.
  const deadCodeWork = shouldRunDeadCode
    ? checkDeadCode({ rootDirectory: directory, userConfig })
    : Promise.resolve<Diagnostic[]>([]);
  // HACK: attach a no-op handler synchronously so a rejection during
  // the lint await window doesn't trigger Node's unhandled-rejection
  // warning. The deferred await below routes the real error into the
  // spinner + skippedChecks tracking.
  deadCodeWork.catch(() => {});

  const lintPromise = resolvedNodeBinaryPath
    ? (async () => {
        const lintSpinner = options.scoreOnly ? null : spinner("Running lint checks...").start();
        try {
          const lintDiagnostics = await runOxlint({
            rootDirectory: directory,
            project: projectInfo,
            includePaths: lintIncludePaths,
            nodeBinaryPath: resolvedNodeBinaryPath,
            customRulesOnly: options.customRulesOnly,
            respectInlineDisables: options.respectInlineDisables,
            adoptExistingLintConfig: options.adoptExistingLintConfig,
            ignoredTags: options.ignoredTags,
            userConfig,
            onPartialFailure: (reason) => lintPartialFailures.push(reason),
          });
          lintSpinner?.succeed("Running lint checks.");
          return lintDiagnostics;
        } catch (error) {
          didLintFail = true;
          const lintErrorChain = formatErrorChain(error);
          lintFailureReason = lintErrorChain;
          if (!options.scoreOnly) {
            const isNativeBindingError = lintErrorChain.includes("native binding");

            if (isNativeBindingError) {
              lintSpinner?.fail(
                `Lint checks failed — oxlint native binding not found (Node ${process.version}).`,
              );
              logger.dim(
                `  Upgrade to Node ${OXLINT_NODE_REQUIREMENT} or run: npx -p oxlint@latest react-doctor@latest`,
              );
            } else {
              lintSpinner?.fail("Lint checks failed (non-fatal, skipping).");
              logger.error(lintErrorChain);
            }
          }
          return [];
        }
      })()
    : Promise.resolve<Diagnostic[]>([]);

  const lintDiagnostics = await lintPromise;

  const deadCodeDiagnostics = shouldRunDeadCode
    ? await (async () => {
        const deadCodeSpinner = options.scoreOnly
          ? null
          : spinner("Analyzing dead code...").start();
        try {
          const result = await deadCodeWork;
          deadCodeSpinner?.succeed("Analyzing dead code.");
          return result;
        } catch (error) {
          didDeadCodeFail = true;
          deadCodeFailureReason = formatErrorChain(error);
          deadCodeSpinner?.fail("Dead-code analysis failed (non-fatal, skipping).");
          return [];
        }
      })()
    : [];

  const diagnostics = combineDiagnostics({
    lintDiagnostics,
    directory,
    isDiffMode,
    userConfig,
    respectInlineDisables: options.respectInlineDisables,
    extraDiagnostics: deadCodeDiagnostics,
  });

  const elapsedMilliseconds = performance.now() - startTime;

  const skippedChecks: string[] = [];
  if (didLintFail) skippedChecks.push("lint");
  if (didDeadCodeFail) skippedChecks.push("dead-code");
  const hasSkippedChecks = skippedChecks.length > 0;

  // HACK: --offline opts out of the score API entirely; without a
  // local fallback (intentional — scoring lives on the server) we
  // simply skip the score in offline mode and the renderer shows the
  // "score unavailable" branch. The message distinguishes the two
  // null sources — `--offline` (user-requested) vs API failure (the
  // network round-trip didn't return a usable score) — so the
  // renderer doesn't claim offline mode when the user is online but
  // the API was unreachable.
  //
  // Pre-filter diagnostics through the `score` surface so weak-signal
  // rule families (e.g. `design`) stay out of scoring by default and
  // don't dilute the headline number. Surface-included diagnostics
  // still flow through `result.diagnostics` for CLI/JSON consumers.
  const scoreDiagnostics = filterDiagnosticsForSurface(diagnostics, "score", userConfig);
  const scoreResult = options.offline ? null : await calculateScore(scoreDiagnostics);
  const noScoreMessage = options.offline
    ? "Score unavailable in offline mode."
    : "Score unavailable (could not reach the score API).";

  const skippedCheckReasons: Record<string, string> = {};
  if (didLintFail && lintFailureReason !== null) {
    skippedCheckReasons.lint = lintFailureReason;
  } else if (lintPartialFailures.length > 0) {
    // Lint as a whole succeeded (we got diagnostics from at least one
    // batch) but some batches timed out — surface the partial-failure
    // notes so JSON consumers see why a few files weren't checked.
    skippedCheckReasons["lint:partial"] = lintPartialFailures.join("; ");
  }
  if (didDeadCodeFail && deadCodeFailureReason !== null) {
    skippedCheckReasons["dead-code"] = deadCodeFailureReason;
  }

  const buildResult = (): InspectResult => ({
    diagnostics,
    score: scoreResult,
    skippedChecks,
    ...(Object.keys(skippedCheckReasons).length > 0 ? { skippedCheckReasons } : {}),
    project: projectInfo,
    elapsedMilliseconds,
  });

  if (options.scoreOnly) {
    if (scoreResult) {
      logger.log(`${scoreResult.score}`);
    } else {
      logger.dim(noScoreMessage);
    }
    return buildResult();
  }

  // `outputSurface` strips weak-signal rule families (default: `design`
  // tag) from the printed list when capturing output destined for a PR
  // comment, so style cleanup can't dilute meaningful React findings.
  // The full diagnostic list is still returned via `buildResult()` so
  // JSON consumers and the score path see everything. The filter always
  // runs (even for the `cli` surface, which ships with no default
  // exclusions) so user-configured `surfaces.cli.exclude*` overrides
  // are honored on the printed output too.
  const surfaceDiagnostics = filterDiagnosticsForSurface(
    diagnostics,
    options.outputSurface,
    userConfig,
  );
  const demotedDiagnosticCount = diagnostics.length - surfaceDiagnostics.length;

  if (surfaceDiagnostics.length === 0) {
    if (hasSkippedChecks) {
      const skippedLabel = skippedChecks.join(" and ");
      logger.warn(
        `No issues detected, but ${skippedLabel} checks failed — results are incomplete.`,
      );
    } else if (demotedDiagnosticCount > 0) {
      logger.success(
        `No issues found! (${demotedDiagnosticCount} demoted from the ${options.outputSurface} surface — see config.surfaces.)`,
      );
    } else {
      logger.success("No issues found!");
    }
    logger.break();
    if (hasSkippedChecks) {
      printBrandingOnlyHeader();
      logger.log(highlighter.gray("  Score not shown — some checks could not complete."));
    } else if (scoreResult) {
      printScoreHeader(scoreResult);
    } else {
      printNoScoreHeader(noScoreMessage);
    }
    return buildResult();
  }

  logger.break();
  printDiagnostics(surfaceDiagnostics, options.verbose, directory);

  if (demotedDiagnosticCount > 0) {
    logger.log(
      highlighter.gray(
        `  ${demotedDiagnosticCount} demoted from the ${options.outputSurface} surface (e.g. design cleanup) — run \`npx react-doctor@latest .\` locally for the full list.`,
      ),
    );
    logger.break();
  }

  const displayedSourceFileCount = isDiffMode ? includePaths.length : lintSourceFileCount;

  const shouldShowShareLink = !options.offline && options.share;
  printSummary(
    surfaceDiagnostics,
    elapsedMilliseconds,
    scoreResult,
    projectInfo.projectName,
    displayedSourceFileCount,
    noScoreMessage,
    !shouldShowShareLink,
  );

  if (hasSkippedChecks) {
    const skippedLabel = skippedChecks.join(" and ");
    logger.break();
    logger.warn(`  Note: ${skippedLabel} checks failed — score may be incomplete.`);
  }

  return buildResult();
};
