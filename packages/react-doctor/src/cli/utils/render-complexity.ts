import { highlighter } from "@react-doctor/core";
import type {
  ComplexityFunctionDelta,
  ComplexityFunctionEntry,
  ComplexityReport,
} from "./complexity-report.js";
import {
  formatComplexityComparisonLocation,
  formatComplexityDelta,
  formatComplexityFunctionLocation,
  formatComplexityKindLabel,
  getComplexityComparisonCyclomatic,
  getComplexityComparisonDisplayFunction,
  isComplexityFunctionEntry,
} from "./complexity-report.js";

const padRight = (value: string, width: number): string => value.padEnd(width);

const padLeft = (value: string, width: number): string => value.padStart(width);

const formatFunctionLabel = (functionEntry: ComplexityFunctionEntry): string =>
  `${functionEntry.name} [${formatComplexityKindLabel(functionEntry.kind)}]`;

const formatComparisonLabel = (comparison: ComplexityFunctionDelta): string => {
  const displayFunction = getComplexityComparisonDisplayFunction(comparison);
  if (displayFunction === null) return "<unknown>";
  return formatFunctionLabel(displayFunction);
};

const colorizeFunctionLabel = (label: string): string => {
  const kindStartIndex = label.lastIndexOf(" [");
  if (kindStartIndex < 0) return highlighter.info(label);
  const namePart = label.slice(0, kindStartIndex);
  const kindPart = label.slice(kindStartIndex);
  return `${highlighter.info(namePart)}${highlighter.dim(kindPart)}`;
};

const formatSummaryValue = (label: string, value: string): string =>
  `${highlighter.dim(`${label}:`.padEnd(20))}${value}`;

const formatFixed = (value: number): string => value.toFixed(2);

const getVisibleFullFunctions = (report: ComplexityReport): ComplexityFunctionEntry[] =>
  report.functions.filter(isComplexityFunctionEntry).slice(0, report.top ?? undefined);

const getVisibleDiffFunctions = (report: ComplexityReport): ComplexityFunctionDelta[] => {
  const visibleFunctions = report.diff?.computed === true ? report.diff.functions : [];
  const filteredFunctions = visibleFunctions.filter(
    (comparison) => getComplexityComparisonCyclomatic(comparison) >= report.minCyclomatic,
  );
  return report.top === null ? filteredFunctions : filteredFunctions.slice(0, report.top);
};

const getFilteredDiffFunctionCount = (report: ComplexityReport): number =>
  (report.diff?.computed === true ? report.diff.functions : []).filter(
    (comparison) => getComplexityComparisonCyclomatic(comparison) >= report.minCyclomatic,
  ).length;

const formatFullReport = (report: ComplexityReport): string[] => {
  const visibleFunctions = getVisibleFullFunctions(report);
  const locationWidth = Math.max(
    "location".length,
    ...visibleFunctions.map(
      (functionEntry) => formatComplexityFunctionLocation(functionEntry).length,
    ),
  );
  const nameWidth = Math.max(
    "function".length,
    ...visibleFunctions.map(
      (functionEntry) =>
        functionEntry.name.length + formatComplexityKindLabel(functionEntry.kind).length + 3,
    ),
  );
  const cyclomaticWidth = Math.max(
    "cyclomatic".length,
    ...visibleFunctions.map((functionEntry) => `${functionEntry.cyclomatic}`.length),
  );
  const cognitiveWidth = Math.max(
    "cognitive".length,
    ...visibleFunctions.map((functionEntry) => `${functionEntry.cognitive}`.length),
  );
  const nestingWidth = Math.max(
    "nesting".length,
    ...visibleFunctions.map((functionEntry) => `${functionEntry.maxNestingDepth}`.length),
  );

  const lines: string[] = [
    highlighter.bold(`Complexity for ${highlighter.info(report.directory)}`),
    formatSummaryValue("files analyzed", highlighter.info(`${report.summary.filesAnalyzed}`)),
    formatSummaryValue("total functions", highlighter.info(`${report.summary.totalFunctions}`)),
    formatSummaryValue(
      "most complex",
      report.summary.mostComplexFunction === null
        ? highlighter.dim("none")
        : `${highlighter.info(formatComplexityFunctionLocation(report.summary.mostComplexFunction))} ${colorizeFunctionLabel(formatFunctionLabel(report.summary.mostComplexFunction))} ${highlighter.dim(`cyclomatic ${report.summary.mostComplexFunction.cyclomatic}, cognitive ${report.summary.mostComplexFunction.cognitive}, nesting ${report.summary.mostComplexFunction.maxNestingDepth}`)}`,
    ),
    "",
    `${padRight("location", locationWidth)}  ${padRight("function", nameWidth)}  ${padLeft("cyclomatic", cyclomaticWidth)}  ${padLeft("cognitive", cognitiveWidth)}  ${padLeft("nesting", nestingWidth)}`,
  ];

  if (report.mode === "diff" && report.diff?.computed === false && report.diff.note) {
    lines.push(highlighter.dim(report.diff.note));
  }

  for (const functionEntry of visibleFunctions) {
    const locationText = padRight(formatComplexityFunctionLocation(functionEntry), locationWidth);
    const functionText = padRight(formatFunctionLabel(functionEntry), nameWidth);
    const cyclomaticText = padLeft(`${functionEntry.cyclomatic}`, cyclomaticWidth);
    const cognitiveText = padLeft(`${functionEntry.cognitive}`, cognitiveWidth);
    const nestingText = padLeft(`${functionEntry.maxNestingDepth}`, nestingWidth);
    lines.push(
      `${highlighter.info(locationText)}  ${colorizeFunctionLabel(functionText)}  ${highlighter.info(cyclomaticText)}  ${highlighter.info(cognitiveText)}  ${highlighter.info(nestingText)}`,
    );
  }

  if (visibleFunctions.length === 0) {
    lines.push(highlighter.dim(`No functions matched --min ${report.minCyclomatic}.`));
  }

  const filteredFunctionCount = report.functions.filter(isComplexityFunctionEntry).length;
  if (report.top !== null && filteredFunctionCount > report.top) {
    lines.push(highlighter.dim(`${filteredFunctionCount - report.top} more…`));
  }

  return lines;
};

const formatDiffReport = (report: ComplexityReport): string[] => {
  const visibleFunctions = getVisibleDiffFunctions(report);
  const locationWidth = Math.max(
    "location".length,
    ...visibleFunctions.map((comparison) => formatComplexityComparisonLocation(comparison).length),
  );
  const nameWidth = Math.max(
    "function".length,
    ...visibleFunctions.map((comparison) => {
      const displayFunction = getComplexityComparisonDisplayFunction(comparison);
      return displayFunction === null
        ? "<unknown>".length
        : displayFunction.name.length + formatComplexityKindLabel(displayFunction.kind).length + 3;
    }),
  );
  const cyclomaticWidth = Math.max(
    "Δ cyclomatic".length,
    ...visibleFunctions.map(
      (comparison) => formatComplexityDelta(comparison.cyclomaticDelta).length,
    ),
  );
  const cognitiveWidth = Math.max(
    "Δ cognitive".length,
    ...visibleFunctions.map(
      (comparison) => formatComplexityDelta(comparison.cognitiveDelta).length,
    ),
  );
  const essentialWidth = Math.max(
    "essential".length,
    ...visibleFunctions.map(
      (comparison) =>
        `${comparison.essentialChangeApproximate ? "~" : ""}${comparison.essentialChange}`.length,
    ),
  );
  const rawLinesWidth = Math.max(
    "raw lines".length,
    ...visibleFunctions.map((comparison) =>
      comparison.rawLinesChanged === null ? 3 : `${comparison.rawLinesChanged}`.length,
    ),
  );
  const bloatWidth = Math.max(
    "bloat".length,
    ...visibleFunctions.map((comparison) =>
      comparison.bloatRatio === null ? 3 : formatFixed(comparison.bloatRatio).length,
    ),
  );
  const nestingWidth = Math.max(
    "nesting".length,
    ...visibleFunctions.map((comparison) => `${comparison.nestingDelta}`.length),
  );
  const statusWidth = Math.max(
    "status".length,
    ...visibleFunctions.map((comparison) => comparison.status.length),
  );

  const lines: string[] = [
    highlighter.bold(`Complexity for ${highlighter.info(report.directory)}`),
    formatSummaryValue("files analyzed", highlighter.info(`${report.summary.filesAnalyzed}`)),
    formatSummaryValue("total functions", highlighter.info(`${report.summary.totalFunctions}`)),
    formatSummaryValue(
      "most complex",
      report.summary.mostComplexFunction === null
        ? highlighter.dim("none")
        : `${highlighter.info(formatComplexityFunctionLocation(report.summary.mostComplexFunction))} ${colorizeFunctionLabel(formatFunctionLabel(report.summary.mostComplexFunction))} ${highlighter.dim(`cyclomatic ${report.summary.mostComplexFunction.cyclomatic}, cognitive ${report.summary.mostComplexFunction.cognitive}, nesting ${report.summary.mostComplexFunction.maxNestingDepth}`)}`,
    ),
    "",
    `${padRight("location", locationWidth)}  ${padRight("function", nameWidth)}  ${padLeft("Δ cyclomatic", cyclomaticWidth)}  ${padLeft("Δ cognitive", cognitiveWidth)}  ${padLeft("essential", essentialWidth)}  ${padLeft("raw lines", rawLinesWidth)}  ${padLeft("bloat", bloatWidth)}  ${padLeft("nesting", nestingWidth)}  ${padLeft("status", statusWidth)}`,
  ];

  for (const comparison of visibleFunctions) {
    const locationText = padRight(formatComplexityComparisonLocation(comparison), locationWidth);
    const functionText = padRight(formatComparisonLabel(comparison), nameWidth);
    const cyclomaticText = padLeft(
      formatComplexityDelta(comparison.cyclomaticDelta),
      cyclomaticWidth,
    );
    const cognitiveText = padLeft(formatComplexityDelta(comparison.cognitiveDelta), cognitiveWidth);
    const essentialText = padLeft(
      `${comparison.essentialChangeApproximate ? "~" : ""}${comparison.essentialChange}`,
      essentialWidth,
    );
    const rawLinesText = padLeft(
      comparison.rawLinesChanged === null ? "n/a" : `${comparison.rawLinesChanged}`,
      rawLinesWidth,
    );
    const bloatText = padLeft(
      comparison.bloatRatio === null ? "n/a" : formatFixed(comparison.bloatRatio),
      bloatWidth,
    );
    const nestingText = padLeft(`${comparison.nestingDelta}`, nestingWidth);
    const statusText = padLeft(comparison.status, statusWidth);
    const coloredStatusText =
      comparison.status === "added"
        ? highlighter.success(statusText)
        : comparison.status === "removed"
          ? highlighter.error(statusText)
          : highlighter.warn(statusText);
    lines.push(
      `${highlighter.info(locationText)}  ${colorizeFunctionLabel(functionText)}  ${highlighter.info(cyclomaticText)}  ${highlighter.info(cognitiveText)}  ${highlighter.info(essentialText)}  ${highlighter.info(rawLinesText)}  ${highlighter.info(bloatText)}  ${highlighter.info(nestingText)}  ${coloredStatusText}`,
    );
  }

  if (visibleFunctions.length === 0) {
    lines.push(highlighter.dim(`No functions matched --min ${report.minCyclomatic}.`));
  }

  if (report.top !== null) {
    const filteredFunctionCount = getFilteredDiffFunctionCount(report);
    if (filteredFunctionCount > report.top) {
      lines.push(highlighter.dim(`${filteredFunctionCount - report.top} more…`));
    }
  }

  if (report.diff?.computed === true) {
    lines.push(
      "",
      highlighter.dim(
        `net cyclomatic ${formatComplexityDelta(report.diff.netCyclomaticChange)}, regressed ${report.diff.regressedCount}, improved ${report.diff.improvedCount}, added ${report.diff.addedCount}, removed ${report.diff.removedCount}`,
      ),
      highlighter.dim(
        `change complexity total essential ${report.diff.totalEssentialChange}, entropy ${formatFixed(report.diff.changeEntropy)} (${formatFixed(report.diff.normalizedChangeEntropy)} normalized), structural risk ${formatFixed(report.diff.totalStructuralRisk)}, score ${formatFixed(report.diff.changeComplexityScore)}`,
      ),
    );
  }

  return lines;
};

export const renderComplexityReport = (report: ComplexityReport): string => {
  const lines =
    report.mode === "diff" && report.diff?.computed === true
      ? formatDiffReport(report)
      : formatFullReport(report);
  return lines.join("\n");
};
