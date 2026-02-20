import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  MILLISECONDS_PER_SECOND,
  OFFLINE_FLAG_MESSAGE,
  OFFLINE_MESSAGE,
  OXLINT_NODE_REQUIREMENT,
  OXLINT_RECOMMENDED_NODE_MAJOR,
  PERFECT_SCORE,
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
import { calculateScore } from "./utils/calculate-score.js";
import { colorizeByScore } from "./utils/colorize-by-score.js";
import { combineDiagnostics, computeJsxIncludePaths } from "./utils/combine-diagnostics.js";
import { discoverProject, formatFrameworkName } from "./utils/discover-project.js";
import { type FramedLine, createFramedLine, printFramedBox } from "./utils/framed-box.js";
import { groupBy } from "./utils/group-by.js";
import { highlighter } from "./utils/highlighter.js";
import { indentMultilineText } from "./utils/indent-multiline-text.js";
import { loadConfig } from "./utils/load-config.js";
import { logger } from "./utils/logger.js";
import { prompts } from "./utils/prompts.js";
import {
  installNodeViaNvm,
  isNvmInstalled,
  resolveNodeForOxlint,
} from "./utils/resolve-compatible-node.js";
import { runKnip } from "./utils/run-knip.js";
import { runOxlint } from "./utils/run-oxlint.js";
import { spinner } from "./utils/spinner.js";

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

const sortBySeverity = (diagnosticGroups: [string, Diagnostic[]][]): [string, Diagnostic[]][] =>
  diagnosticGroups.toSorted(([, diagnosticsA], [, diagnosticsB]) => {
    const severityA = SEVERITY_ORDER[diagnosticsA[0].severity];
    const severityB = SEVERITY_ORDER[diagnosticsB[0].severity];
    return severityA - severityB;
  });

const collectAffectedFiles = (diagnostics: Diagnostic[]): Set<string> =>
  new Set(diagnostics.map((diagnostic) => diagnostic.filePath));

const buildFileLineMap = (diagnostics: Diagnostic[]): Map<string, number[]> => {
  const fileLines = new Map<string, number[]>();
  for (const diagnostic of diagnostics) {
    const lines = fileLines.get(diagnostic.filePath) ?? [];
    if (diagnostic.line > 0) {
      lines.push(diagnostic.line);
    }
    fileLines.set(diagnostic.filePath, lines);
  }
  return fileLines;
};

const printDiagnostics = (diagnostics: Diagnostic[], isVerbose: boolean): void => {
  const ruleGroups = groupBy(
    diagnostics,
    (diagnostic) => `${diagnostic.plugin}/${diagnostic.rule}`,
  );

  const sortedRuleGroups = sortBySeverity([...ruleGroups.entries()]);

  for (const [, ruleDiagnostics] of sortedRuleGroups) {
    const firstDiagnostic = ruleDiagnostics[0];
    const severitySymbol = firstDiagnostic.severity === "error" ? "✗" : "⚠";
    const icon = colorizeBySeverity(severitySymbol, firstDiagnostic.severity);
    const count = ruleDiagnostics.length;
    const countLabel = count > 1 ? colorizeBySeverity(` (${count})`, firstDiagnostic.severity) : "";

    logger.log(`  ${icon} ${firstDiagnostic.message}${countLabel}`);
    if (firstDiagnostic.help) {
      logger.dim(indentMultilineText(firstDiagnostic.help, "    "));
    }

    if (isVerbose) {
      const fileLines = buildFileLineMap(ruleDiagnostics);

      for (const [filePath, lines] of fileLines) {
        const lineLabel = lines.length > 0 ? `: ${lines.join(", ")}` : "";
        logger.dim(`    ${filePath}${lineLabel}`);
      }
    }

    logger.break();
  }
};

const formatElapsedTime = (elapsedMilliseconds: number): string => {
  if (elapsedMilliseconds < MILLISECONDS_PER_SECOND) {
    return `${Math.round(elapsedMilliseconds)}ms`;
  }
  return `${(elapsedMilliseconds / MILLISECONDS_PER_SECOND).toFixed(1)}s`;
};

const formatRuleSummary = (ruleKey: string, ruleDiagnostics: Diagnostic[]): string => {
  const firstDiagnostic = ruleDiagnostics[0];
  const fileLines = buildFileLineMap(ruleDiagnostics);

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
  for (const [filePath, lines] of fileLines) {
    const lineLabel = lines.length > 0 ? `: ${lines.join(", ")}` : "";
    sections.push(`  ${filePath}${lineLabel}`);
  }

  return sections.join("\n") + "\n";
};

const writeDiagnosticsDirectory = (diagnostics: Diagnostic[]): string => {
  const outputDirectory = join(tmpdir(), `react-doctor-${randomUUID()}`);
  mkdirSync(outputDirectory);

  const ruleGroups = groupBy(
    diagnostics,
    (diagnostic) => `${diagnostic.plugin}/${diagnostic.rule}`,
  );
  const sortedRuleGroups = sortBySeverity([...ruleGroups.entries()]);

  for (const [ruleKey, ruleDiagnostics] of sortedRuleGroups) {
    const fileName = ruleKey.replace(/\//g, "--") + ".txt";
    writeFileSync(join(outputDirectory, fileName), formatRuleSummary(ruleKey, ruleDiagnostics));
  }

  writeFileSync(join(outputDirectory, "diagnostics.json"), JSON.stringify(diagnostics, null, 2));

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

const buildPlainScoreBar = (score: number): string => {
  const { filledSegment, emptySegment } = buildScoreBarSegments(score);
  return `${filledSegment}${emptySegment}`;
};

const buildScoreBar = (score: number): string => {
  const { filledSegment, emptySegment } = buildScoreBarSegments(score);
  return colorizeByScore(filledSegment, score) + highlighter.dim(emptySegment);
};

const printScoreGauge = (score: number, label: string): void => {
  const scoreDisplay = colorizeByScore(`${score}`, score);
  const labelDisplay = colorizeByScore(label, score);
  logger.log(`  ${scoreDisplay} / ${PERFECT_SCORE}  ${labelDisplay}`);
  logger.break();
  logger.log(`  ${buildScoreBar(score)}`);
  logger.break();
};

const getDoctorFace = (score: number): string[] => {
  if (score >= SCORE_GOOD_THRESHOLD) return ["◠ ◠", " ▽ "];
  if (score >= SCORE_OK_THRESHOLD) return ["• •", " ─ "];
  return ["x x", " ▽ "];
};

const printBranding = (score?: number): void => {
  if (score !== undefined) {
    const [eyes, mouth] = getDoctorFace(score);
    const colorize = (text: string) => colorizeByScore(text, score);
    logger.log(colorize("  ┌─────┐"));
    logger.log(colorize(`  │ ${eyes} │`));
    logger.log(colorize(`  │ ${mouth} │`));
    logger.log(colorize("  └─────┘"));
  }
  logger.log(`  React Doctor ${highlighter.dim("(www.react-doctor.com)")}`);
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

const buildBrandingLines = (
  scoreResult: ScoreResult | null,
  noScoreMessage: string,
): FramedLine[] => {
  const lines: FramedLine[] = [];

  if (scoreResult) {
    const [eyes, mouth] = getDoctorFace(scoreResult.score);
    const scoreColorizer = (text: string): string => colorizeByScore(text, scoreResult.score);

    lines.push(createFramedLine("┌─────┐", scoreColorizer("┌─────┐")));
    lines.push(createFramedLine(`│ ${eyes} │`, scoreColorizer(`│ ${eyes} │`)));
    lines.push(createFramedLine(`│ ${mouth} │`, scoreColorizer(`│ ${mouth} │`)));
    lines.push(createFramedLine("└─────┘", scoreColorizer("└─────┘")));
    lines.push(
      createFramedLine(
        "React Doctor (www.react-doctor.com)",
        `React Doctor ${highlighter.dim("(www.react-doctor.com)")}`,
      ),
    );
    lines.push(createFramedLine(""));

    const scoreLinePlainText = `${scoreResult.score} / ${PERFECT_SCORE}  ${scoreResult.label}`;
    const scoreLineRenderedText = `${colorizeByScore(String(scoreResult.score), scoreResult.score)} / ${PERFECT_SCORE}  ${colorizeByScore(scoreResult.label, scoreResult.score)}`;
    lines.push(createFramedLine(scoreLinePlainText, scoreLineRenderedText));
    lines.push(createFramedLine(""));
    lines.push(
      createFramedLine(buildPlainScoreBar(scoreResult.score), buildScoreBar(scoreResult.score)),
    );
    lines.push(createFramedLine(""));
  } else {
    lines.push(
      createFramedLine(
        "React Doctor (www.react-doctor.com)",
        `React Doctor ${highlighter.dim("(www.react-doctor.com)")}`,
      ),
    );
    lines.push(createFramedLine(""));
    lines.push(createFramedLine(noScoreMessage, highlighter.dim(noScoreMessage)));
    lines.push(createFramedLine(""));
  }

  return lines;
};

const buildCountsSummaryLine = (
  diagnostics: Diagnostic[],
  totalSourceFileCount: number,
  elapsedMilliseconds: number,
): FramedLine => {
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
  const affectedFileCount = collectAffectedFiles(diagnostics).size;
  const elapsed = formatElapsedTime(elapsedMilliseconds);

  const plainParts: string[] = [];
  const renderedParts: string[] = [];

  if (errorCount > 0) {
    const errorText = `✗ ${errorCount} error${errorCount === 1 ? "" : "s"}`;
    plainParts.push(errorText);
    renderedParts.push(highlighter.error(errorText));
  }
  if (warningCount > 0) {
    const warningText = `⚠ ${warningCount} warning${warningCount === 1 ? "" : "s"}`;
    plainParts.push(warningText);
    renderedParts.push(highlighter.warn(warningText));
  }

  const fileCountText =
    totalSourceFileCount > 0
      ? `across ${affectedFileCount}/${totalSourceFileCount} files`
      : `across ${affectedFileCount} file${affectedFileCount === 1 ? "" : "s"}`;
  const elapsedTimeText = `in ${elapsed}`;

  plainParts.push(fileCountText, elapsedTimeText);
  renderedParts.push(highlighter.dim(fileCountText), highlighter.dim(elapsedTimeText));

  return createFramedLine(plainParts.join("  "), renderedParts.join("  "));
};

const printSummary = (
  diagnostics: Diagnostic[],
  elapsedMilliseconds: number,
  scoreResult: ScoreResult | null,
  projectName: string,
  totalSourceFileCount: number,
  noScoreMessage: string,
): void => {
  const summaryFramedLines = [
    ...buildBrandingLines(scoreResult, noScoreMessage),
    buildCountsSummaryLine(diagnostics, totalSourceFileCount, elapsedMilliseconds),
  ];
  printFramedBox(summaryFramedLines);

  try {
    const diagnosticsDirectory = writeDiagnosticsDirectory(diagnostics);
    logger.break();
    logger.dim(`  Full diagnostics written to ${diagnosticsDirectory}`);
  } catch {
    logger.break();
  }

  const shareUrl = buildShareUrl(diagnostics, scoreResult, projectName);
  logger.break();
  logger.dim(`  Share your results: ${highlighter.info(shareUrl)}`);
};

const resolveOxlintNode = async (
  isLintEnabled: boolean,
  isScoreOnly: boolean,
): Promise<string | null> => {
  if (!isLintEnabled) return null;

  const nodeResolution = resolveNodeForOxlint();

  if (nodeResolution) {
    if (!nodeResolution.isCurrentNode && !isScoreOnly) {
      logger.warn(
        `Node ${process.version} is unsupported by oxlint. Using Node ${nodeResolution.version} from nvm.`,
      );
      logger.break();
    }
    return nodeResolution.binaryPath;
  }

  if (isScoreOnly) return null;

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
  includePaths: string[];
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
  includePaths: inputOptions.includePaths ?? [],
});

const printProjectDetection = (
  projectInfo: ProjectInfo,
  userConfig: ReactDoctorConfig | null,
  isDiffMode: boolean,
  includePaths: string[],
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
    completeStep(`Found ${highlighter.info(`${projectInfo.sourceFileCount}`)} source files.`);
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
  const projectInfo = discoverProject(directory);
  const userConfig = loadConfig(directory);
  const options = mergeScanOptions(inputOptions, userConfig);
  const { includePaths } = options;
  const isDiffMode = includePaths.length > 0;

  if (!projectInfo.reactVersion) {
    throw new Error("No React dependency found in package.json");
  }

  if (!options.scoreOnly) {
    printProjectDetection(projectInfo, userConfig, isDiffMode, includePaths);
  }

  const jsxIncludePaths = computeJsxIncludePaths(includePaths);

  let didLintFail = false;
  let didDeadCodeFail = false;

  const resolvedNodeBinaryPath = await resolveOxlintNode(options.lint, options.scoreOnly);
  if (options.lint && !resolvedNodeBinaryPath) didLintFail = true;

  const lintPromise = resolvedNodeBinaryPath
    ? (async () => {
        const lintSpinner = options.scoreOnly ? null : spinner("Running lint checks...").start();
        try {
          const lintDiagnostics = await runOxlint(
            directory,
            projectInfo.hasTypeScript,
            projectInfo.framework,
            projectInfo.hasReactCompiler,
            jsxIncludePaths,
            resolvedNodeBinaryPath,
          );
          lintSpinner?.succeed("Running lint checks.");
          return lintDiagnostics;
        } catch (error) {
          didLintFail = true;
          const errorMessage = error instanceof Error ? error.message : String(error);
          const isNativeBindingError = errorMessage.includes("native binding");

          if (isNativeBindingError) {
            lintSpinner?.fail(
              `Lint checks failed — oxlint native binding not found (Node ${process.version}).`,
            );
            logger.dim(
              `  Upgrade to Node ${OXLINT_NODE_REQUIREMENT} or run: npx -p oxlint@latest react-doctor@latest`,
            );
          } else {
            lintSpinner?.fail("Lint checks failed (non-fatal, skipping).");
            logger.error(errorMessage);
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
            deadCodeSpinner?.fail("Dead code detection failed (non-fatal, skipping).");
            logger.error(String(error));
            return [];
          }
        })()
      : Promise.resolve<Diagnostic[]>([]);

  const [lintDiagnostics, deadCodeDiagnostics] = await Promise.all([lintPromise, deadCodePromise]);
  const diagnostics = combineDiagnostics(
    lintDiagnostics,
    deadCodeDiagnostics,
    directory,
    isDiffMode,
    userConfig,
  );

  const elapsedMilliseconds = performance.now() - startTime;

  const skippedChecks: string[] = [];
  if (didLintFail) skippedChecks.push("lint");
  if (didDeadCodeFail) skippedChecks.push("dead code");
  const hasSkippedChecks = skippedChecks.length > 0;

  const scoreResult = options.offline ? null : await calculateScore(diagnostics);
  const noScoreMessage = options.offline ? OFFLINE_FLAG_MESSAGE : OFFLINE_MESSAGE;

  if (options.scoreOnly) {
    if (scoreResult) {
      logger.log(`${scoreResult.score}`);
    } else {
      logger.dim(noScoreMessage);
    }
    return { diagnostics, scoreResult, skippedChecks };
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
      printBranding();
      logger.dim("  Score not shown — some checks could not complete.");
    } else if (scoreResult) {
      printBranding(scoreResult.score);
      printScoreGauge(scoreResult.score, scoreResult.label);
    } else {
      logger.dim(`  ${noScoreMessage}`);
    }
    return { diagnostics, scoreResult, skippedChecks };
  }

  printDiagnostics(diagnostics, options.verbose);

  const displayedSourceFileCount = isDiffMode ? includePaths.length : projectInfo.sourceFileCount;

  printSummary(
    diagnostics,
    elapsedMilliseconds,
    scoreResult,
    projectInfo.projectName,
    displayedSourceFileCount,
    noScoreMessage,
  );

  if (hasSkippedChecks) {
    const skippedLabel = skippedChecks.join(" and ");
    logger.break();
    logger.warn(`  Note: ${skippedLabel} checks failed — score may be incomplete.`);
  }

  return { diagnostics, scoreResult, skippedChecks };
};
