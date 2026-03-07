import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MILLISECONDS_PER_SECOND } from "../constants.js";
import type { Diagnostic, MarkdownReportData } from "../types.js";
import { formatFrameworkName } from "./discover-project.js";
import { groupBy } from "./group-by.js";

const SEVERITY_SORT_KEYS: Record<Diagnostic["severity"], string> = {
  error: "error",
  warning: "warning",
};

const sanitizeInlineText = (value: string): string => value.replace(/\s+/g, " ").trim();

const collectAffectedFileCount = (diagnostics: Diagnostic[]): number =>
  new Set(diagnostics.map((diagnostic) => diagnostic.filePath)).size;

const countErrorDiagnostics = (diagnostics: Diagnostic[]): number =>
  diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;

const countWarningDiagnostics = (diagnostics: Diagnostic[]): number =>
  diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;

const formatElapsedTime = (elapsedMilliseconds: number): string => {
  if (elapsedMilliseconds < MILLISECONDS_PER_SECOND) {
    return `${Math.round(elapsedMilliseconds)}ms`;
  }
  return `${(elapsedMilliseconds / MILLISECONDS_PER_SECOND).toFixed(1)}s`;
};

const buildFileLineMap = (diagnostics: Diagnostic[]): Map<string, number[]> => {
  const fileLineMap = new Map<string, number[]>();

  for (const diagnostic of diagnostics) {
    const currentLines = fileLineMap.get(diagnostic.filePath) ?? [];
    if (diagnostic.line > 0) {
      currentLines.push(diagnostic.line);
    }
    fileLineMap.set(diagnostic.filePath, currentLines);
  }

  return fileLineMap;
};

const formatFileLineReferences = (diagnostics: Diagnostic[]): string[] => {
  const fileLineMap = buildFileLineMap(diagnostics);
  const sortedEntries = [...fileLineMap.entries()].toSorted(([filePathA], [filePathB]) =>
    filePathA.localeCompare(filePathB),
  );

  return sortedEntries.map(([filePath, lineNumbers]) => {
    const uniqueSortedLineNumbers = [...new Set(lineNumbers)].toSorted((lineA, lineB) => lineA - lineB);
    const lineSuffix =
      uniqueSortedLineNumbers.length > 0 ? `:${uniqueSortedLineNumbers.join(",")}` : "";
    return `\`${filePath}${lineSuffix}\``;
  });
};

const sortRuleGroups = (ruleGroups: [string, Diagnostic[]][]): [string, Diagnostic[]][] =>
  ruleGroups.toSorted(([ruleKeyA, diagnosticsA], [ruleKeyB, diagnosticsB]) => {
    const severitySortKeyA = SEVERITY_SORT_KEYS[diagnosticsA[0].severity];
    const severitySortKeyB = SEVERITY_SORT_KEYS[diagnosticsB[0].severity];
    const severityComparison = severitySortKeyA.localeCompare(severitySortKeyB);

    if (severityComparison !== 0) return severityComparison;
    return ruleKeyA.localeCompare(ruleKeyB);
  });

const buildFindingsSectionLines = (diagnostics: Diagnostic[]): string[] => {
  if (diagnostics.length === 0) {
    return ["No diagnostics found."];
  }

  const findingsLines: string[] = [];
  const ruleGroups = groupBy(
    diagnostics,
    (diagnostic) => `${diagnostic.plugin}/${diagnostic.rule}`,
  );
  const sortedRuleGroups = sortRuleGroups([...ruleGroups.entries()]);

  for (const [ruleKey, ruleDiagnostics] of sortedRuleGroups) {
    const firstDiagnostic = ruleDiagnostics[0];
    const fileLineReferences = formatFileLineReferences(ruleDiagnostics);

    findingsLines.push(`##### ${ruleKey}`);
    findingsLines.push(`- Severity: ${firstDiagnostic.severity}`);
    findingsLines.push(`- Category: ${firstDiagnostic.category}`);
    findingsLines.push(`- Count: ${ruleDiagnostics.length}`);
    findingsLines.push(`- Message: ${sanitizeInlineText(firstDiagnostic.message)}`);
    if (firstDiagnostic.help) {
      findingsLines.push(`- Suggestion: ${sanitizeInlineText(firstDiagnostic.help)}`);
    }
    findingsLines.push("- Files:");
    for (const fileLineReference of fileLineReferences) {
      findingsLines.push(`  - ${fileLineReference}`);
    }
    findingsLines.push("");
  }

  if (findingsLines[findingsLines.length - 1] === "") {
    findingsLines.pop();
  }

  return findingsLines;
};

const buildProjectSectionLines = (markdownReportData: MarkdownReportData): string[] => {
  const projectSectionLines: string[] = ["## Projects", ""];

  if (markdownReportData.projects.length === 0) {
    projectSectionLines.push("No projects were scanned.");
    return projectSectionLines;
  }

  for (const project of markdownReportData.projects) {
    const errorCount = countErrorDiagnostics(project.diagnostics);
    const warningCount = countWarningDiagnostics(project.diagnostics);
    const affectedFileCount = collectAffectedFileCount(project.diagnostics);
    const skippedChecksLabel =
      project.skippedChecks.length > 0 ? project.skippedChecks.join(", ") : "none";
    const scoreLabel = project.scoreResult
      ? `${project.scoreResult.score} (${project.scoreResult.label})`
      : "Not calculated";

    projectSectionLines.push(`### ${project.projectName}`);
    projectSectionLines.push("");
    projectSectionLines.push(`- Directory: \`${project.projectDirectory}\``);
    projectSectionLines.push(`- Framework: ${formatFrameworkName(project.framework)}`);
    projectSectionLines.push(`- React Version: ${project.reactVersion ?? "Not detected"}`);
    projectSectionLines.push(`- Score: ${scoreLabel}`);
    projectSectionLines.push(
      `- Diagnostics: ${project.diagnostics.length} (${errorCount} errors, ${warningCount} warnings)`,
    );
    projectSectionLines.push(
      `- Affected Files: ${affectedFileCount}/${project.sourceFileCount}`,
    );
    projectSectionLines.push(`- Elapsed: ${formatElapsedTime(project.elapsedMilliseconds)}`);
    projectSectionLines.push(`- Skipped Checks: ${skippedChecksLabel}`);
    projectSectionLines.push("");
    projectSectionLines.push("#### Findings");
    projectSectionLines.push("");
    projectSectionLines.push(...buildFindingsSectionLines(project.diagnostics));
    projectSectionLines.push("");
  }

  if (projectSectionLines[projectSectionLines.length - 1] === "") {
    projectSectionLines.pop();
  }

  return projectSectionLines;
};

const buildMarkdownReportContent = (markdownReportData: MarkdownReportData): string => {
  const errorCount = countErrorDiagnostics(markdownReportData.diagnostics);
  const warningCount = countWarningDiagnostics(markdownReportData.diagnostics);
  const affectedFileCount = collectAffectedFileCount(markdownReportData.diagnostics);
  const modeLabel = markdownReportData.isDiffMode ? "diff" : "full";

  const reportLines = [
    "# React Doctor Report",
    "",
    "## Run",
    `- Generated At: ${markdownReportData.generatedAtIso}`,
    `- Root Directory: \`${markdownReportData.rootDirectory}\``,
    `- Projects Scanned: ${markdownReportData.projects.length}`,
    `- Mode: ${modeLabel}`,
    `- Lint: ${markdownReportData.isLintEnabled ? "enabled" : "disabled"}`,
    `- Dead Code: ${markdownReportData.isDeadCodeEnabled ? "enabled" : "disabled"}`,
    `- Verbose: ${markdownReportData.isVerboseEnabled ? "enabled" : "disabled"}`,
    `- Score Only: ${markdownReportData.isScoreOnly ? "enabled" : "disabled"}`,
    `- Offline: ${markdownReportData.isOffline ? "enabled" : "disabled"}`,
    "",
    "## Totals",
    `- Diagnostics: ${markdownReportData.diagnostics.length}`,
    `- Errors: ${errorCount}`,
    `- Warnings: ${warningCount}`,
    `- Affected Files: ${affectedFileCount}`,
    "",
    ...buildProjectSectionLines(markdownReportData),
  ];

  return `${reportLines.join("\n").trimEnd()}\n`;
};

const resolveMarkdownReportPath = (
  markdownReportData: MarkdownReportData,
  markdownReportPath: string,
): string =>
  path.isAbsolute(markdownReportPath)
    ? markdownReportPath
    : path.resolve(markdownReportData.rootDirectory, markdownReportPath);

export const writeMarkdownReport = (
  markdownReportData: MarkdownReportData,
  markdownReportPath: string,
): string => {
  const resolvedMarkdownReportPath = resolveMarkdownReportPath(
    markdownReportData,
    markdownReportPath,
  );
  const reportDirectoryPath = path.dirname(resolvedMarkdownReportPath);
  mkdirSync(reportDirectoryPath, { recursive: true });
  writeFileSync(
    resolvedMarkdownReportPath,
    buildMarkdownReportContent(markdownReportData),
    "utf-8",
  );
  return resolvedMarkdownReportPath;
};
