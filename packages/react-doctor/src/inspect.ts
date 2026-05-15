import { performance } from "node:perf_hooks";
import {
  OXLINT_NODE_REQUIREMENT,
  SCORE_UNAVAILABLE_OFFLINE_MESSAGE,
  calculateScore,
  combineDiagnostics,
  computeJsxIncludePaths,
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
  InspectOptions,
  InspectResult,
  ReactDoctorConfig,
} from "@react-doctor/types";
import { printDiagnostics } from "./cli/render-diagnostics.js";
import { printProjectDetection } from "./cli/render-project-detection.js";
import {
  printBrandingOnlyHeader,
  printNoScoreHeader,
  printScoreHeader,
} from "./cli/render-score-header.js";
import { printSummary } from "./cli/render-summary.js";
import { resolveOxlintNode } from "./cli/resolve-oxlint-node.js";
import { isSpinnerSilent, setSpinnerSilent, spinner } from "./cli/spinner.js";

interface ResolvedInspectOptions {
  lint: boolean;
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

  const resolvedNodeBinaryPath = await resolveOxlintNode(
    options.lint,
    options.scoreOnly || options.silent,
  );
  if (options.lint && !resolvedNodeBinaryPath) didLintFail = true;

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
          });
          lintSpinner?.succeed("Running lint checks.");
          return lintDiagnostics;
        } catch (error) {
          didLintFail = true;
          if (!options.scoreOnly) {
            const lintErrorChain = formatErrorChain(error);
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
  const diagnostics = combineDiagnostics({
    lintDiagnostics,
    directory,
    isDiffMode,
    userConfig,
    respectInlineDisables: options.respectInlineDisables,
  });

  const elapsedMilliseconds = performance.now() - startTime;

  const skippedChecks: string[] = [];
  if (didLintFail) skippedChecks.push("lint");
  const hasSkippedChecks = skippedChecks.length > 0;

  // HACK: --offline opts out of the score API entirely; without a
  // local fallback (intentional — scoring lives on the server) we
  // simply skip the score in offline mode and the renderer shows the
  // "score unavailable" branch.
  const scoreResult = options.offline ? null : await calculateScore(diagnostics);
  const noScoreMessage = SCORE_UNAVAILABLE_OFFLINE_MESSAGE;

  const buildResult = (): InspectResult => ({
    diagnostics,
    score: scoreResult,
    skippedChecks,
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

  if (diagnostics.length === 0) {
    if (hasSkippedChecks) {
      const skippedLabel = skippedChecks.join(" and ");
      logger.warn(
        `No issues detected, but ${skippedLabel} checks failed — results are incomplete.`,
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
  printDiagnostics(diagnostics, options.verbose, directory);

  const displayedSourceFileCount = isDiffMode ? includePaths.length : lintSourceFileCount;

  const shouldShowShareLink = !options.offline && options.share;
  printSummary(
    diagnostics,
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
