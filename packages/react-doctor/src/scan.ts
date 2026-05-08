import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  CATEGORY_BAR_WIDTH_CHARS,
  CATEGORY_LABEL_COLUMN_WIDTH_CHARS,
  MAX_DETAILED_RULE_GROUPS_NON_VERBOSE,
  MAX_RULE_GROUPS_SHOWN_NON_VERBOSE,
  MILLISECONDS_PER_SECOND,
  buildNoReactDependencyError,
  OFFLINE_MESSAGE,
  OXLINT_NODE_REQUIREMENT,
  OXLINT_RECOMMENDED_NODE_MAJOR,
  PERFECT_SCORE,
  RULE_NAME_COLUMN_WIDTH_CHARS,
  SCORE_BAR_WIDTH_CHARS,
  SCORE_GOOD_THRESHOLD,
  SCORE_OK_THRESHOLD,
  SHARE_BASE_URL,
} from "./constants.js";
import type {
  Diagnostic,
  ProjectInfo,
  ReactDoctorConfig,
  ScanOptions,
  ScanResult,
  ScoreResult,
} from "./types.js";
import {
  buildCategoryBreakdown,
  type CategoryBreakdownEntry,
} from "./utils/build-category-breakdown.js";
import { buildHiddenDiagnosticsSummary } from "./utils/build-hidden-diagnostics-summary.js";
import { calculateScore, calculateScoreLocally } from "./utils/calculate-score.js";
import { colorizeByScore } from "./utils/colorize-by-score.js";
import { combineDiagnostics } from "./utils/combine-diagnostics.js";
import { computeJsxIncludePaths } from "./utils/jsx-include-paths.js";
import { discoverProject, formatFrameworkName } from "./utils/discover-project.js";
import { formatErrorChain } from "./utils/format-error-chain.js";
import { groupBy } from "./utils/group-by.js";
import { highlighter } from "./utils/highlighter.js";
import { indentMultilineText } from "./utils/indent-multiline-text.js";
import { toRelativePath } from "./utils/to-relative-path.js";
import { loadConfig } from "./utils/load-config.js";
import { isLoggerSilent, logger, setLoggerSilent } from "./utils/logger.js";
import { prompts } from "./utils/prompts.js";
import {
  installNodeViaNvm,
  isNvmInstalled,
  resolveNodeForOxlint,
} from "./utils/resolve-compatible-node.js";
import { resolveLintIncludePaths } from "./utils/resolve-lint-include-paths.js";
import { runKnip } from "./utils/run-knip.js";
import { parseReactMajor } from "./utils/parse-react-major.js";
import { runOxlint } from "./utils/run-oxlint.js";
import { isSpinnerSilent, setSpinnerSilent, spinner } from "./utils/spinner.js";

interface ScoreBarSegments {
  filledSegment: string;
  emptySegment: string;
}

const SEVERITY_ORDER: Record<Diagnostic["severity"], number> = {
  error: 0,
  warning: 1,
};

const colorizeBySeverity = (text: string, severity: Diagnostic["severity"]): string =>
  severity === "error" ? highlighter.error(text) : highlighter.warn(text);

const sortByImportance = (diagnosticGroups: [string, Diagnostic[]][]): [string, Diagnostic[]][] =>
  diagnosticGroups.toSorted(([, diagnosticsA], [, diagnosticsB]) => {
    const severityDelta =
      SEVERITY_ORDER[diagnosticsA[0].severity] - SEVERITY_ORDER[diagnosticsB[0].severity];
    if (severityDelta !== 0) return severityDelta;
    return diagnosticsB.length - diagnosticsA.length;
  });

const collectAffectedFiles = (diagnostics: Diagnostic[]): Set<string> =>
  new Set(diagnostics.map((diagnostic) => diagnostic.filePath));

interface VerboseSiteEntry {
  line: number;
  suppressionHint?: string;
}

const buildVerboseSiteMap = (diagnostics: Diagnostic[]): Map<string, VerboseSiteEntry[]> => {
  const fileSites = new Map<string, VerboseSiteEntry[]>();
  for (const diagnostic of diagnostics) {
    const sites = fileSites.get(diagnostic.filePath) ?? [];
    if (diagnostic.line > 0) {
      sites.push({ line: diagnostic.line, suppressionHint: diagnostic.suppressionHint });
    }
    fileSites.set(diagnostic.filePath, sites);
  }
  return fileSites;
};

const formatSiteCountBadge = (count: number): string => (count > 1 ? `×${count}` : "");

const computeRuleNameColumnWidth = (ruleKeys: string[]): number => {
  const longestRuleNameLength = ruleKeys.reduce(
    (longest, ruleKey) => Math.max(longest, ruleKey.length),
    0,
  );
  return Math.max(RULE_NAME_COLUMN_WIDTH_CHARS, longestRuleNameLength);
};

const padRuleNameToColumn = (ruleName: string, columnWidth: number): string => {
  if (ruleName.length >= columnWidth) return ruleName;
  return ruleName + " ".repeat(columnWidth - ruleName.length);
};

const grayLine = (text: string): void => {
  logger.log(highlighter.gray(text));
};

const printCompactRuleGroupLine = (
  ruleKey: string,
  ruleDiagnostics: Diagnostic[],
  ruleNameColumnWidth: number,
): void => {
  const firstDiagnostic = ruleDiagnostics[0];
  const severitySymbol = firstDiagnostic.severity === "error" ? "✗" : "⚠";
  const icon = colorizeBySeverity(severitySymbol, firstDiagnostic.severity);
  const siteCountBadge = formatSiteCountBadge(ruleDiagnostics.length);
  const ruleNameRendering =
    siteCountBadge.length > 0
      ? colorizeBySeverity(
          padRuleNameToColumn(ruleKey, ruleNameColumnWidth),
          firstDiagnostic.severity,
        )
      : colorizeBySeverity(ruleKey, firstDiagnostic.severity);
  const trailingBadge = siteCountBadge.length > 0 ? ` ${highlighter.gray(siteCountBadge)}` : "";
  logger.log(`  ${icon} ${ruleNameRendering}${trailingBadge}`);
};

const printDetailedRuleGroup = (
  ruleKey: string,
  ruleDiagnostics: Diagnostic[],
  rootDirectory: string,
  ruleNameColumnWidth: number,
): void => {
  printCompactRuleGroupLine(ruleKey, ruleDiagnostics, ruleNameColumnWidth);
  const firstDiagnostic = ruleDiagnostics[0];
  grayLine(indentMultilineText(firstDiagnostic.message, "      "));
  if (firstDiagnostic.help) {
    grayLine(indentMultilineText(`→ ${firstDiagnostic.help}`, "      "));
  }
  const firstLocation = ruleDiagnostics.find((diagnostic) => diagnostic.line > 0);
  if (firstLocation) {
    const locationPath = toRelativePath(firstLocation.filePath, rootDirectory);
    grayLine(`      ${locationPath}:${firstLocation.line}`);
  }
  logger.break();
};

const printVerboseRuleGroup = (
  ruleKey: string,
  ruleDiagnostics: Diagnostic[],
  ruleNameColumnWidth: number,
): void => {
  printCompactRuleGroupLine(ruleKey, ruleDiagnostics, ruleNameColumnWidth);
  const firstDiagnostic = ruleDiagnostics[0];
  grayLine(indentMultilineText(firstDiagnostic.message, "      "));
  if (firstDiagnostic.help) {
    grayLine(indentMultilineText(`→ ${firstDiagnostic.help}`, "      "));
  }
  const fileSites = buildVerboseSiteMap(ruleDiagnostics);
  for (const [filePath, sites] of fileSites) {
    if (sites.length > 0) {
      for (const site of sites) {
        grayLine(`      ${filePath}:${site.line}`);
        if (site.suppressionHint) {
          grayLine(`        ↳ ${site.suppressionHint}`);
        }
      }
    } else {
      grayLine(`      ${filePath}`);
    }
  }
  logger.break();
};

const printDiagnostics = (
  diagnostics: Diagnostic[],
  isVerbose: boolean,
  rootDirectory: string,
): void => {
  const ruleGroups = groupBy(
    diagnostics,
    (diagnostic) => `${diagnostic.plugin}/${diagnostic.rule}`,
  );

  const sortedRuleGroups = sortByImportance([...ruleGroups.entries()]);
  const visibleRuleGroups = isVerbose
    ? sortedRuleGroups
    : sortedRuleGroups.slice(0, MAX_RULE_GROUPS_SHOWN_NON_VERBOSE);
  const hiddenRuleGroups = isVerbose
    ? []
    : sortedRuleGroups.slice(MAX_RULE_GROUPS_SHOWN_NON_VERBOSE);

  const ruleNameColumnWidth = computeRuleNameColumnWidth(
    visibleRuleGroups.map(([ruleKey]) => ruleKey),
  );

  visibleRuleGroups.forEach(([ruleKey, ruleDiagnostics], visibleIndex) => {
    if (isVerbose) {
      printVerboseRuleGroup(ruleKey, ruleDiagnostics, ruleNameColumnWidth);
      return;
    }
    if (visibleIndex < MAX_DETAILED_RULE_GROUPS_NON_VERBOSE) {
      printDetailedRuleGroup(ruleKey, ruleDiagnostics, rootDirectory, ruleNameColumnWidth);
      return;
    }
    printCompactRuleGroupLine(ruleKey, ruleDiagnostics, ruleNameColumnWidth);
  });

  if (visibleRuleGroups.length > MAX_DETAILED_RULE_GROUPS_NON_VERBOSE && !isVerbose) {
    logger.break();
  }

  if (hiddenRuleGroups.length > 0) {
    printHiddenDiagnosticsSummary(hiddenRuleGroups);
  }
};

const printHiddenDiagnosticsSummary = (hiddenRuleGroups: [string, Diagnostic[]][]): void => {
  const hiddenDiagnostics = hiddenRuleGroups.flatMap(([, ruleDiagnostics]) => ruleDiagnostics);
  const renderedParts = buildHiddenDiagnosticsSummary(hiddenDiagnostics).map((part) =>
    colorizeBySeverity(part.text, part.severity),
  );

  logger.log(`  ${renderedParts.join("  ")}`);
  grayLine("    Run `npx react-doctor@latest . --verbose` to get all details");
  logger.break();
};

const formatElapsedTime = (elapsedMilliseconds: number): string => {
  if (elapsedMilliseconds < MILLISECONDS_PER_SECOND) {
    return `${Math.round(elapsedMilliseconds)}ms`;
  }
  return `${(elapsedMilliseconds / MILLISECONDS_PER_SECOND).toFixed(1)}s`;
};

const formatRuleSummary = (ruleKey: string, ruleDiagnostics: Diagnostic[]): string => {
  const firstDiagnostic = ruleDiagnostics[0];

  const sections = [
    `Rule: ${ruleKey}`,
    `Severity: ${firstDiagnostic.severity}`,
    `Category: ${firstDiagnostic.category}`,
    `Count: ${ruleDiagnostics.length}`,
    "",
    firstDiagnostic.message,
  ];

  if (firstDiagnostic.help) {
    sections.push("", `Suggestion: ${firstDiagnostic.help}`);
  }

  sections.push("", "Files:");
  const fileSites = buildVerboseSiteMap(ruleDiagnostics);
  for (const [filePath, sites] of fileSites) {
    if (sites.length > 0) {
      for (const site of sites) {
        sections.push(`  ${filePath}:${site.line}`);
        if (site.suppressionHint) {
          sections.push(`    ${site.suppressionHint}`);
        }
      }
    } else {
      sections.push(`  ${filePath}`);
    }
  }

  return sections.join("\n") + "\n";
};

const writeDiagnosticsDirectory = (diagnostics: Diagnostic[]): string => {
  const outputDirectory = join(tmpdir(), `react-doctor-${randomUUID()}`);
  mkdirSync(outputDirectory, { recursive: true });

  const ruleGroups = groupBy(
    diagnostics,
    (diagnostic) => `${diagnostic.plugin}/${diagnostic.rule}`,
  );
  const sortedRuleGroups = sortByImportance([...ruleGroups.entries()]);

  for (const [ruleKey, ruleDiagnostics] of sortedRuleGroups) {
    const fileName = ruleKey.replace(/\//g, "--") + ".txt";
    writeFileSync(join(outputDirectory, fileName), formatRuleSummary(ruleKey, ruleDiagnostics));
  }

  writeFileSync(join(outputDirectory, "diagnostics.json"), JSON.stringify(diagnostics));

  return outputDirectory;
};

const buildScoreBarSegments = (score: number): ScoreBarSegments => {
  const filledCount = Math.round((score / PERFECT_SCORE) * SCORE_BAR_WIDTH_CHARS);
  const emptyCount = SCORE_BAR_WIDTH_CHARS - filledCount;

  return {
    filledSegment: "█".repeat(filledCount),
    emptySegment: "░".repeat(emptyCount),
  };
};

const buildScoreBar = (score: number): string => {
  const { filledSegment, emptySegment } = buildScoreBarSegments(score);
  return colorizeByScore(filledSegment, score) + highlighter.dim(emptySegment);
};

const getDoctorFace = (score: number): string[] => {
  if (score >= SCORE_GOOD_THRESHOLD) return ["◠ ◠", " ▽ "];
  if (score >= SCORE_OK_THRESHOLD) return ["• •", " ─ "];
  return ["x x", " ▽ "];
};

const BRANDING_LINE = `React Doctor ${highlighter.dim("(www.react.doctor)")}`;

const buildFaceRenderedLines = (score: number): string[] => {
  const [eyes, mouth] = getDoctorFace(score);
  const colorize = (text: string) => colorizeByScore(text, score);
  return ["┌─────┐", `│ ${eyes} │`, `│ ${mouth} │`, "└─────┘"].map(colorize);
};

const printScoreHeader = (scoreResult: ScoreResult): void => {
  const renderedFaceLines = buildFaceRenderedLines(scoreResult.score);

  const scoreNumber = colorizeByScore(`${scoreResult.score}`, scoreResult.score);
  const scoreLabel = colorizeByScore(scoreResult.label, scoreResult.score);
  const scoreLine = `${scoreNumber} ${highlighter.dim(`/ ${PERFECT_SCORE}`)} ${scoreLabel}`;
  const scoreBarLine = buildScoreBar(scoreResult.score);

  const rightColumnLines = [scoreLine, scoreBarLine, BRANDING_LINE, ""];

  for (let lineIndex = 0; lineIndex < renderedFaceLines.length; lineIndex += 1) {
    const rightColumnContent = rightColumnLines[lineIndex] ?? "";
    const separator = rightColumnContent.length > 0 ? "  " : "";
    logger.log(`  ${renderedFaceLines[lineIndex]}${separator}${rightColumnContent}`);
  }

  logger.break();
};

const printBrandingOnlyHeader = (): void => {
  logger.log(`  ${BRANDING_LINE}`);
  logger.break();
};

const printNoScoreHeader = (noScoreMessage: string): void => {
  logger.log(`  ${BRANDING_LINE}`);
  logger.log(`  ${highlighter.gray(noScoreMessage)}`);
  logger.break();
};

const buildCategoryBar = (count: number, maximumCount: number, useErrorColor: boolean): string => {
  if (maximumCount === 0) return highlighter.dim("░".repeat(CATEGORY_BAR_WIDTH_CHARS));
  const filledCount = Math.max(1, Math.round((count / maximumCount) * CATEGORY_BAR_WIDTH_CHARS));
  const cappedFilledCount = Math.min(filledCount, CATEGORY_BAR_WIDTH_CHARS);
  const emptyCount = CATEGORY_BAR_WIDTH_CHARS - cappedFilledCount;
  const filledSegment = "█".repeat(cappedFilledCount);
  const emptySegment = "░".repeat(emptyCount);
  const colorizedFilled = useErrorColor
    ? highlighter.error(filledSegment)
    : highlighter.warn(filledSegment);
  return `${colorizedFilled}${highlighter.dim(emptySegment)}`;
};

const padCategoryLabel = (categoryLabel: string): string => {
  if (categoryLabel.length >= CATEGORY_LABEL_COLUMN_WIDTH_CHARS) return categoryLabel;
  return categoryLabel + " ".repeat(CATEGORY_LABEL_COLUMN_WIDTH_CHARS - categoryLabel.length);
};

const printCategoryBreakdown = (entries: CategoryBreakdownEntry[]): void => {
  if (entries.length === 0) return;
  const maximumCount = Math.max(...entries.map((entry) => entry.totalCount));
  logger.dim("  By category");
  for (const entry of entries) {
    const paddedLabel = padCategoryLabel(entry.category);
    const categoryBar = buildCategoryBar(entry.totalCount, maximumCount, entry.errorCount > 0);
    const totalCountDisplay = String(entry.totalCount);
    const errorBadge = entry.errorCount > 0 ? ` ${highlighter.error(`${entry.errorCount}×`)}` : "";
    logger.log(`    ${paddedLabel}${categoryBar} ${totalCountDisplay}${errorBadge}`);
  }
  logger.break();
};

const buildShareUrl = (
  diagnostics: Diagnostic[],
  scoreResult: ScoreResult | null,
  projectName: string,
): string => {
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
  const affectedFileCount = collectAffectedFiles(diagnostics).size;

  const params = new URLSearchParams();
  params.set("p", projectName);
  if (scoreResult) params.set("s", String(scoreResult.score));
  if (errorCount > 0) params.set("e", String(errorCount));
  if (warningCount > 0) params.set("w", String(warningCount));
  if (affectedFileCount > 0) params.set("f", String(affectedFileCount));

  return `${SHARE_BASE_URL}?${params.toString()}`;
};

const printCountsSummaryLine = (
  diagnostics: Diagnostic[],
  totalSourceFileCount: number,
  elapsedMilliseconds: number,
): void => {
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
  const affectedFileCount = collectAffectedFiles(diagnostics).size;
  const totalIssueCount = diagnostics.length;
  const elapsedTimeLabel = formatElapsedTime(elapsedMilliseconds);

  const issueCountColor =
    errorCount > 0 ? highlighter.error : warningCount > 0 ? highlighter.warn : highlighter.dim;
  const issueCountText = `${totalIssueCount} ${totalIssueCount === 1 ? "issue" : "issues"}`;
  const fileCountText =
    totalSourceFileCount > 0
      ? `across ${affectedFileCount}/${totalSourceFileCount} files`
      : `across ${affectedFileCount} file${affectedFileCount === 1 ? "" : "s"}`;
  const elapsedTimeText = `in ${elapsedTimeLabel}`;

  logger.log(
    `  ${issueCountColor(issueCountText)} ${highlighter.dim(`${fileCountText}  ${elapsedTimeText}`)}`,
  );
};

const printSummary = (
  diagnostics: Diagnostic[],
  elapsedMilliseconds: number,
  scoreResult: ScoreResult | null,
  projectName: string,
  totalSourceFileCount: number,
  noScoreMessage: string,
  isOffline: boolean,
): void => {
  printCategoryBreakdown(buildCategoryBreakdown(diagnostics));

  if (scoreResult) {
    printScoreHeader(scoreResult);
  } else {
    printNoScoreHeader(noScoreMessage);
  }

  printCountsSummaryLine(diagnostics, totalSourceFileCount, elapsedMilliseconds);

  try {
    const diagnosticsDirectory = writeDiagnosticsDirectory(diagnostics);
    logger.log(highlighter.gray(`  Full diagnostics written to ${diagnosticsDirectory}`));
  } catch {
    /* swallow — failing to write the dump shouldn't block the summary */
  }

  if (!isOffline) {
    logger.break();
    const shareUrl = buildShareUrl(diagnostics, scoreResult, projectName);
    logger.log(`  ${highlighter.bold("→ Share your results:")} ${highlighter.info(shareUrl)}`);
  }
};

const resolveOxlintNode = async (
  isLintEnabled: boolean,
  isQuiet: boolean,
): Promise<string | null> => {
  if (!isLintEnabled) return null;

  const nodeResolution = resolveNodeForOxlint();

  if (nodeResolution) {
    if (!nodeResolution.isCurrentNode && !isQuiet) {
      logger.warn(
        `Node ${process.version} is unsupported by oxlint. Using Node ${nodeResolution.version} from nvm.`,
      );
      logger.break();
    }
    return nodeResolution.binaryPath;
  }

  if (isQuiet) return null;

  logger.warn(
    `Node ${process.version} is not compatible with oxlint (requires ${OXLINT_NODE_REQUIREMENT}). Lint checks will be skipped.`,
  );

  if (isNvmInstalled() && process.stdin.isTTY) {
    const { shouldInstallNode } = await prompts({
      type: "confirm",
      name: "shouldInstallNode",
      message: `Install Node ${OXLINT_RECOMMENDED_NODE_MAJOR} via nvm to enable lint checks?`,
      initial: true,
    });

    if (shouldInstallNode) {
      logger.break();
      const freshResolution = installNodeViaNvm() ? resolveNodeForOxlint() : null;
      if (freshResolution) {
        logger.break();
        logger.success(`Node ${freshResolution.version} installed. Using it for lint checks.`);
        logger.break();
        return freshResolution.binaryPath;
      }
      logger.break();
      logger.warn("Failed to install Node via nvm. Skipping lint checks.");
      logger.break();
      return null;
    }
  } else if (isNvmInstalled()) {
    logger.dim(`  Run: nvm install ${OXLINT_RECOMMENDED_NODE_MAJOR}`);
  } else {
    logger.dim(
      `  Install nvm (https://github.com/nvm-sh/nvm) and run: nvm install ${OXLINT_RECOMMENDED_NODE_MAJOR}`,
    );
  }

  logger.break();
  return null;
};

interface ResolvedScanOptions {
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
}

const mergeScanOptions = (
  inputOptions: ScanOptions,
  userConfig: ReactDoctorConfig | null,
): ResolvedScanOptions => ({
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
});

const printProjectDetection = (
  projectInfo: ProjectInfo,
  userConfig: ReactDoctorConfig | null,
  isDiffMode: boolean,
  includePaths: string[],
  lintSourceFileCount?: number,
): void => {
  const frameworkLabel = formatFrameworkName(projectInfo.framework);
  const languageLabel = projectInfo.hasTypeScript ? "TypeScript" : "JavaScript";

  const completeStep = (message: string) => {
    spinner(message).start().succeed(message);
  };

  completeStep(`Detecting framework. Found ${highlighter.info(frameworkLabel)}.`);
  completeStep(
    `Detecting React version. Found ${highlighter.info(`React ${projectInfo.reactVersion}`)}.`,
  );
  completeStep(`Detecting language. Found ${highlighter.info(languageLabel)}.`);
  completeStep(
    `Detecting React Compiler. ${projectInfo.hasReactCompiler ? highlighter.info("Found React Compiler.") : "Not found."}`,
  );

  if (isDiffMode) {
    completeStep(`Scanning ${highlighter.info(`${includePaths.length}`)} changed source files.`);
  } else {
    completeStep(
      `Found ${highlighter.info(`${lintSourceFileCount ?? projectInfo.sourceFileCount}`)} source files.`,
    );
  }

  if (userConfig) {
    completeStep(`Loaded ${highlighter.info("react-doctor config")}.`);
  }

  logger.break();
};

export const scan = async (
  directory: string,
  inputOptions: ScanOptions = {},
): Promise<ScanResult> => {
  const startTime = performance.now();
  const userConfig =
    inputOptions.configOverride !== undefined ? inputOptions.configOverride : loadConfig(directory);
  const options = mergeScanOptions(inputOptions, userConfig);

  const wasLoggerSilent = isLoggerSilent();
  const wasSpinnerSilent = isSpinnerSilent();
  if (options.silent) {
    setLoggerSilent(true);
    setSpinnerSilent(true);
  }

  try {
    return await runScan(directory, options, userConfig, startTime);
  } finally {
    if (options.silent) {
      setLoggerSilent(wasLoggerSilent);
      setSpinnerSilent(wasSpinnerSilent);
    }
  }
};

const runScan = async (
  directory: string,
  options: ResolvedScanOptions,
  userConfig: ReactDoctorConfig | null,
  startTime: number,
): Promise<ScanResult> => {
  const projectInfo = discoverProject(directory);
  const { includePaths } = options;
  const isDiffMode = includePaths.length > 0;

  if (!projectInfo.reactVersion) {
    throw new Error(buildNoReactDependencyError(directory));
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
            hasTypeScript: projectInfo.hasTypeScript,
            framework: projectInfo.framework,
            hasReactCompiler: projectInfo.hasReactCompiler,
            hasTanStackQuery: projectInfo.hasTanStackQuery,
            reactMajorVersion: parseReactMajor(projectInfo.reactVersion),
            includePaths: lintIncludePaths,
            nodeBinaryPath: resolvedNodeBinaryPath,
            customRulesOnly: options.customRulesOnly,
            respectInlineDisables: options.respectInlineDisables,
            adoptExistingLintConfig: options.adoptExistingLintConfig,
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
            const knipDiagnostics = await runKnip(directory);
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

  const buildResult = (): ScanResult => ({
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
