import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { SEPARATOR_LENGTH_CHARS } from "./constants.js";
import type { Diagnostic, ScanOptions } from "./types.js";
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

const collectAffectedFiles = (diagnostics: Diagnostic[]): Set<string> => {
  const files = new Set<string>();
  for (const diagnostic of diagnostics) {
    files.add(diagnostic.filePath);
  }
  return files;
};

const printDiagnostics = (diagnostics: Diagnostic[]): void => {
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

    const fileLines = new Map<string, number[]>();
    for (const diagnostic of ruleDiagnostics) {
      const lines = fileLines.get(diagnostic.filePath) ?? [];
      if (diagnostic.line > 0) {
        lines.push(diagnostic.line);
      }
      fileLines.set(diagnostic.filePath, lines);
    }

    for (const [filePath, lines] of fileLines) {
      const lineLabel = lines.length > 0 ? `: ${lines.join(", ")}` : "";
      logger.dim(`    ${filePath}${lineLabel}`);
    }

    logger.break();
  }
};

const formatElapsedTime = (elapsedMilliseconds: number): string => {
  if (elapsedMilliseconds < 1000) {
    return `${Math.round(elapsedMilliseconds)}ms`;
  }
  return `${(elapsedMilliseconds / 1000).toFixed(1)}s`;
};

const formatRuleSummary = (ruleKey: string, ruleDiagnostics: Diagnostic[]): string => {
  const firstDiagnostic = ruleDiagnostics[0];
  const fileLines = new Map<string, number[]>();
  for (const diagnostic of ruleDiagnostics) {
    const lines = fileLines.get(diagnostic.filePath) ?? [];
    if (diagnostic.line > 0) lines.push(diagnostic.line);
    fileLines.set(diagnostic.filePath, lines);
  }

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

const printSummary = (diagnostics: Diagnostic[], elapsedMilliseconds: number): void => {
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
  const affectedFileCount = collectAffectedFiles(diagnostics).size;
  const elapsed = formatElapsedTime(elapsedMilliseconds);

  logger.log("─".repeat(SEPARATOR_LENGTH_CHARS));
  logger.break();

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

  logger.log(parts.join("  "));

  try {
    const diagnosticsDirectory = writeDiagnosticsDirectory(diagnostics);
    logger.break();
    logger.dim(`Full diagnostics written to ${diagnosticsDirectory}`);
  } catch {
    logger.break();
  }
};

export const scan = async (directory: string, options: ScanOptions): Promise<void> => {
  const startTime = performance.now();
  const projectInfo = discoverProject(directory);

  if (!projectInfo.reactVersion) {
    throw new Error("No React dependency found in package.json");
  }

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

  const diagnostics: Diagnostic[] = [];

  if (options.lint) {
    const lintSpinner = spinner("Running lint checks...").start();
    try {
      diagnostics.push(
        ...(await runOxlint(
          directory,
          projectInfo.hasTypeScript,
          projectInfo.framework,
          projectInfo.hasReactCompiler,
        )),
      );
      lintSpinner.succeed("Running lint checks.");
    } catch {
      lintSpinner.fail("Lint checks failed (non-fatal, skipping).");
    }
  }

  if (options.deadCode) {
    const deadCodeSpinner = spinner("Detecting dead code...").start();
    try {
      diagnostics.push(...(await runKnip(directory)));
      deadCodeSpinner.succeed("Detecting dead code.");
    } catch {
      deadCodeSpinner.fail("Dead code detection failed (non-fatal, skipping).");
    }
  }

  diagnostics.push(...checkReducedMotion(directory));

  const elapsedMilliseconds = performance.now() - startTime;

  if (diagnostics.length === 0) {
    logger.success("No issues found!");
    return;
  }

  printDiagnostics(diagnostics);

  printSummary(diagnostics, elapsedMilliseconds);
};
