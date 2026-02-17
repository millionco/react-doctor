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
  SEPARATOR_LENGTH_CHARS,
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

const SEVERITY_ORDER: Record<Diagnostic["severity"], number> = {
  error: 0,
  warning: 1,
};

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
    const icon =
      firstDiagnostic.severity === "error" ? highlighter.error("✗") : highlighter.warn("⚠");
    const count = ruleDiagnostics.length;
    const countLabel = count > 1 ? ` (${count})` : "";

    logger.log(`  ${icon} ${firstDiagnostic.message}${countLabel}`);
    if (firstDiagnostic.help) {
      logger.dim(`    ${firstDiagnostic.help}`);
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

const buildScoreBar = (score: number): string => {
  const filledCount = Math.round((score / PERFECT_SCORE) * SCORE_BAR_WIDTH_CHARS);
  const emptyCount = SCORE_BAR_WIDTH_CHARS - filledCount;
  const filled = "█".repeat(filledCount);
  const empty = "░".repeat(emptyCount);
  return colorizeByScore(filled, score) + highlighter.dim(empty);
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

  logger.log("─".repeat(SEPARATOR_LENGTH_CHARS));
  logger.break();

  printBranding(scoreResult?.score);

  if (scoreResult) {
    printScoreGauge(scoreResult.score, scoreResult.label);
  } else {
    logger.dim(`  ${OFFLINE_MESSAGE}`);
    logger.break();
  }

  const parts: string[] = [];
  if (errorCount > 0) {
    parts.push(highlighter.error(`${errorCount} error${errorCount === 1 ? "" : "s"}`));
  }
  if (warningCount > 0) {
    parts.push(highlighter.warn(`${warningCount} warning${warningCount === 1 ? "" : "s"}`));
  }
  parts.push(
    highlighter.dim(`across ${affectedFileCount} file${affectedFileCount === 1 ? "" : "s"}`),
  );
  parts.push(highlighter.dim(`in ${elapsed}`));

  logger.log(`  ${parts.join("  ")}`);

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
