import { performance } from "node:perf_hooks";
import {
  ERROR_RULE_PENALTY,
  OFFLINE_MESSAGE,
  OXLINT_NODE_REQUIREMENT,
  PERFECT_SCORE,
  WARNING_RULE_PENALTY,
} from "../constants.js";
import {
  printBrandingOnlyHeader,
  printScoreHeader,
  printNoScoreHeader,
} from "../cli/render-score-header.js";
import { printDiagnostics } from "../cli/render-diagnostics.js";
import { printProjectDetection } from "../cli/render-project-detection.js";
import { printSummary } from "../cli/render-summary.js";
import { resolveOxlintNode } from "../cli/resolve-oxlint-node.js";
import { NoReactDependencyError } from "../errors.js";
import type { ReactDoctorConfig } from "../types/config.js";
import type { Diagnostic } from "../types/diagnostic.js";
import type { InspectOptions, InspectResult } from "../types/inspect.js";
import {
  calculateScore,
  calculateScoreBreakdown,
  calculateScoreLocally,
} from "./calculate-score.js";
import { combineDiagnostics } from "./combine-diagnostics.js";
import { discoverProject } from "./discover-project.js";
import { formatErrorChain } from "./format-error-chain.js";
import { highlighter } from "./highlighter.js";
import { computeJsxIncludePaths } from "./jsx-include-paths.js";
import { loadConfigWithSource } from "./load-config.js";
import { isLoggerSilent, logger, setLoggerSilent } from "./logger.js";
import { resolveConfigRootDir } from "./resolve-config-root-dir.js";
import { resolveLintIncludePaths } from "./resolve-lint-include-paths.js";
import { runKnip } from "./run-knip.js";
import { runOxlint } from "./run-oxlint.js";
import { isSpinnerSilent, setSpinnerSilent, spinner } from "../cli/spinner.js";

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
});

export const inspect = async (
  directory: string,
  inputOptions: InspectOptions = {},
): Promise<InspectResult> => {
  const startTime = performance.now();

  // configOverride means the caller (typically the CLI) already resolved
  // both the config and any rootDir redirect; trust their directory
  // verbatim. Otherwise honor `rootDir` from the loaded config so direct
  // programmatic `inspect()` callers get the same redirect as `diagnose()`.
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
  let didDeadCodeFail = false;

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

  const deadCodePromise =
    options.deadCode && !isDiffMode
      ? (async () => {
          const deadCodeSpinner = options.scoreOnly
            ? null
            : spinner("Detecting dead code...").start();
          try {
            const knipDiagnostics = await runKnip(directory, userConfig?.entryFiles);
            deadCodeSpinner?.succeed("Detecting dead code.");
            return knipDiagnostics;
          } catch (error) {
            didDeadCodeFail = true;
            if (!options.scoreOnly) {
              deadCodeSpinner?.fail("Dead code detection failed (non-fatal, skipping).");
              logger.error(formatErrorChain(error));
            }
            return [];
          }
        })()
      : Promise.resolve<Diagnostic[]>([]);

  const [lintDiagnostics, deadCodeDiagnostics] = await Promise.all([lintPromise, deadCodePromise]);
  const diagnostics = combineDiagnostics({
    lintDiagnostics,
    deadCodeDiagnostics,
    directory,
    isDiffMode,
    userConfig,
    respectInlineDisables: options.respectInlineDisables,
  });

  const elapsedMilliseconds = performance.now() - startTime;

  const skippedChecks: string[] = [];
  if (didLintFail) skippedChecks.push("lint");
  if (didDeadCodeFail) skippedChecks.push("dead code");
  const hasSkippedChecks = skippedChecks.length > 0;

  const scoreResult = options.offline
    ? calculateScoreLocally(diagnostics)
    : await calculateScore(diagnostics);
  const noScoreMessage = OFFLINE_MESSAGE;

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

  if (options.verbose && scoreResult && diagnostics.length > 0) {
    const breakdown = calculateScoreBreakdown(diagnostics);
    logger.break();
    logger.dim(
      `  Score formula: ${PERFECT_SCORE} - (${breakdown.errorRules.length} error rules × ${ERROR_RULE_PENALTY}) - (${breakdown.warningRules.length} warning rules × ${WARNING_RULE_PENALTY}) = ${breakdown.score}`,
    );
    if (breakdown.errorRules.length > 0) {
      logger.dim(`  Error rules (−${breakdown.errorPenalty}): ${breakdown.errorRules.join(", ")}`);
    }
    if (breakdown.warningRules.length > 0) {
      logger.dim(
        `  Warning rules (−${breakdown.warningPenalty}): ${breakdown.warningRules.join(", ")}`,
      );
    }
  }

  if (hasSkippedChecks) {
    const skippedLabel = skippedChecks.join(" and ");
    logger.break();
    logger.warn(`  Note: ${skippedLabel} checks failed — score may be incomplete.`);
  }

  return buildResult();
};
