import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  MILLISECONDS_PER_SECOND,
  OFFLINE_MESSAGE,
  PERFECT_SCORE,
  SCORE_BAR_WIDTH_CHARS,
  SCORE_GOOD_THRESHOLD,
  SCORE_OK_THRESHOLD,
  SUMMARY_BOX_HORIZONTAL_PADDING_CHARS,
  SUMMARY_BOX_OUTER_INDENT_CHARS,
  SHARE_BASE_URL,
} from "./constants.js";
import type { Diagnostic, ScanOptions, ScoreResult } from "./types.js";
import { calculateScore } from "./utils/calculate-score.js";
import { discoverProject, formatFrameworkName } from "./utils/discover-project.js";
import { groupBy } from "./utils/group-by.js";
import { highlighter } from "./utils/highlighter.js";
import { logger } from "./utils/logger.js";
import { checkReducedMotion } from "./utils/check-reduced-motion.js";
import { runKnip } from "./utils/run-knip.js";
import { runOxlint } from "./utils/run-oxlint.js";
import { spinner } from "./utils/spinner.js";
import { indentMultilineText } from "./utils/indent-multiline-text.js";

interface FramedLine {
  plainText: string;
  renderedText: string;
}

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
    const countLabel =
      count > 1 ? colorizeBySeverity(` (${count})`, firstDiagnostic.severity) : "";

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

const colorizeByScore = (text: string, score: number): string => {
  if (score >= SCORE_GOOD_THRESHOLD) return highlighter.success(text);
  if (score >= SCORE_OK_THRESHOLD) return highlighter.warn(text);
  return highlighter.error(text);
};

const createFramedLine = (plainText: string, renderedText: string = plainText): FramedLine => ({
  plainText,
  renderedText,
});

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

const printFramedBox = (framedLines: FramedLine[]): void => {
  if (framedLines.length === 0) {
    return;
  }

  const borderColorizer = highlighter.dim;
  const outerIndent = " ".repeat(SUMMARY_BOX_OUTER_INDENT_CHARS);
  const horizontalPadding = " ".repeat(SUMMARY_BOX_HORIZONTAL_PADDING_CHARS);
  const maximumLineLength = Math.max(
    ...framedLines.map((framedLine) => framedLine.plainText.length),
  );
  const borderLine = "─".repeat(maximumLineLength + SUMMARY_BOX_HORIZONTAL_PADDING_CHARS * 2);

  logger.log(`${outerIndent}${borderColorizer(`┌${borderLine}┐`)}`);

  for (const framedLine of framedLines) {
    const trailingSpaces = " ".repeat(maximumLineLength - framedLine.plainText.length);
    logger.log(
      `${outerIndent}${borderColorizer("│")}${horizontalPadding}${framedLine.renderedText}${trailingSpaces}${horizontalPadding}${borderColorizer("│")}`,
    );
  }

  logger.log(`${outerIndent}${borderColorizer(`└${borderLine}┘`)}`);
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
  logger.log(`  React Doctor ${highlighter.dim("(www.react.doctor)")}`);
  logger.break();
};

const buildShareUrl = (diagnostics: Diagnostic[], scoreResult: ScoreResult | null): string => {
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
  const affectedFileCount = collectAffectedFiles(diagnostics).size;

  const params = new URLSearchParams();
  if (scoreResult) params.set("s", String(scoreResult.score));
  if (errorCount > 0) params.set("e", String(errorCount));
  if (warningCount > 0) params.set("w", String(warningCount));
  if (affectedFileCount > 0) params.set("f", String(affectedFileCount));

  return `${SHARE_BASE_URL}?${params.toString()}`;
};

const printSummary = (
  diagnostics: Diagnostic[],
  elapsedMilliseconds: number,
  scoreResult: ScoreResult | null,
): void => {
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
  const affectedFileCount = collectAffectedFiles(diagnostics).size;
  const elapsed = formatElapsedTime(elapsedMilliseconds);

  const summaryLineParts: string[] = [];
  const summaryLinePartsPlain: string[] = [];
  if (errorCount > 0) {
    const errorText = `✗ ${errorCount} error${errorCount === 1 ? "" : "s"}`;
    summaryLinePartsPlain.push(errorText);
    summaryLineParts.push(highlighter.error(errorText));
  }
  if (warningCount > 0) {
    const warningText = `⚠ ${warningCount} warning${warningCount === 1 ? "" : "s"}`;
    summaryLinePartsPlain.push(warningText);
    summaryLineParts.push(highlighter.warn(warningText));
  }
  const fileCountText = `across ${affectedFileCount} file${affectedFileCount === 1 ? "" : "s"}`;
  const elapsedTimeText = `in ${elapsed}`;

  summaryLinePartsPlain.push(fileCountText);
  summaryLinePartsPlain.push(elapsedTimeText);
  summaryLineParts.push(highlighter.dim(fileCountText));
  summaryLineParts.push(highlighter.dim(elapsedTimeText));

  const summaryFramedLines: FramedLine[] = [];
  if (scoreResult) {
    const [eyes, mouth] = getDoctorFace(scoreResult.score);
    const scoreColorizer = (text: string): string => colorizeByScore(text, scoreResult.score);

    summaryFramedLines.push(createFramedLine("┌─────┐", scoreColorizer("┌─────┐")));
    summaryFramedLines.push(createFramedLine(`│ ${eyes} │`, scoreColorizer(`│ ${eyes} │`)));
    summaryFramedLines.push(createFramedLine(`│ ${mouth} │`, scoreColorizer(`│ ${mouth} │`)));
    summaryFramedLines.push(createFramedLine("└─────┘", scoreColorizer("└─────┘")));
    summaryFramedLines.push(
      createFramedLine(
        "React Doctor (www.react.doctor)",
        `React Doctor ${highlighter.dim("(www.react.doctor)")}`,
      ),
    );
    summaryFramedLines.push(createFramedLine(""));

    const scoreLinePlainText = `${scoreResult.score} / ${PERFECT_SCORE}  ${scoreResult.label}`;
    const scoreLineRenderedText = `${colorizeByScore(String(scoreResult.score), scoreResult.score)} / ${PERFECT_SCORE}  ${colorizeByScore(scoreResult.label, scoreResult.score)}`;
    summaryFramedLines.push(createFramedLine(scoreLinePlainText, scoreLineRenderedText));
    summaryFramedLines.push(createFramedLine(""));
    summaryFramedLines.push(
      createFramedLine(buildPlainScoreBar(scoreResult.score), buildScoreBar(scoreResult.score)),
    );
    summaryFramedLines.push(createFramedLine(""));
  } else {
    summaryFramedLines.push(
      createFramedLine(
        "React Doctor (www.react.doctor)",
        `React Doctor ${highlighter.dim("(www.react.doctor)")}`,
      ),
    );
    summaryFramedLines.push(createFramedLine(""));
    summaryFramedLines.push(createFramedLine(OFFLINE_MESSAGE, highlighter.dim(OFFLINE_MESSAGE)));
    summaryFramedLines.push(createFramedLine(""));
  }

  summaryFramedLines.push(
    createFramedLine(summaryLinePartsPlain.join("  "), summaryLineParts.join("  ")),
  );
  printFramedBox(summaryFramedLines);

  try {
    const diagnosticsDirectory = writeDiagnosticsDirectory(diagnostics);
    logger.break();
    logger.dim(`  Full diagnostics written to ${diagnosticsDirectory}`);
  } catch {
    logger.break();
  }

  const shareUrl = buildShareUrl(diagnostics, scoreResult);
  logger.break();
  logger.dim(`  Share your results: ${highlighter.info(shareUrl)}`);
};

export const scan = async (directory: string, options: ScanOptions): Promise<void> => {
  const startTime = performance.now();
  const projectInfo = discoverProject(directory);

  if (!projectInfo.reactVersion) {
    throw new Error("No React dependency found in package.json");
  }

  if (!options.scoreOnly) {
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
    completeStep(`Found ${highlighter.info(`${projectInfo.sourceFileCount}`)} source files.`);

    logger.break();
  }

  const lintPromise = options.lint
    ? (async () => {
        const lintSpinner = options.scoreOnly ? null : spinner("Running lint checks...").start();
        try {
          const lintDiagnostics = await runOxlint(
            directory,
            projectInfo.hasTypeScript,
            projectInfo.framework,
            projectInfo.hasReactCompiler,
          );
          lintSpinner?.succeed("Running lint checks.");
          return lintDiagnostics;
        } catch {
          lintSpinner?.fail("Lint checks failed (non-fatal, skipping).");
          return [];
        }
      })()
    : Promise.resolve<Diagnostic[]>([]);

  const deadCodePromise = options.deadCode
    ? (async () => {
        const deadCodeSpinner = options.scoreOnly
          ? null
          : spinner("Detecting dead code...").start();
        try {
          const knipDiagnostics = await runKnip(directory);
          deadCodeSpinner?.succeed("Detecting dead code.");
          return knipDiagnostics;
        } catch {
          deadCodeSpinner?.fail("Dead code detection failed (non-fatal, skipping).");
          return [];
        }
      })()
    : Promise.resolve<Diagnostic[]>([]);

  const [lintDiagnostics, deadCodeDiagnostics] = await Promise.all([lintPromise, deadCodePromise]);
  const diagnostics = [
    ...lintDiagnostics,
    ...deadCodeDiagnostics,
    ...checkReducedMotion(directory),
  ];

  const elapsedMilliseconds = performance.now() - startTime;

  const scoreResult = await calculateScore(diagnostics);

  if (options.scoreOnly) {
    if (scoreResult) {
      logger.log(`${scoreResult.score}`);
    } else {
      logger.dim(OFFLINE_MESSAGE);
    }
    return;
  }

  if (diagnostics.length === 0) {
    logger.success("No issues found!");
    logger.break();
    if (scoreResult) {
      printBranding(scoreResult.score);
      printScoreGauge(scoreResult.score, scoreResult.label);
    } else {
      logger.dim(`  ${OFFLINE_MESSAGE}`);
    }
    return;
  }

  printDiagnostics(diagnostics, options.verbose);

  printSummary(diagnostics, elapsedMilliseconds, scoreResult);
};
