import { highlighter } from "@react-doctor/core";
import { buildMeterBar } from "./build-meter-bar.js";
import {
  COMPLEXITY_DIFF_CALLOUT_MIN_BLOAT_RATIO,
  COMPLEXITY_DIFF_CALLOUT_MIN_RAW_LINES_CHANGED,
  COMPLEXITY_DIFF_CALLOUT_PURE_CHURN_MAX_ESSENTIAL_CHANGE,
  COMPLEXITY_SCORE_BAR_WIDTH_CHARS,
  COMPLEXITY_TABLE_MIN_FUNCTION_WIDTH_CHARS,
  COMPLEXITY_TABLE_MIN_LOCATION_WIDTH_CHARS,
} from "./constants.js";
import { buildSectionDivider } from "./build-section-divider.js";
import { colorizeByScore } from "./colorize-by-score.js";
import {
  type ComplexityFunctionDelta,
  type ComplexityFunctionEntry,
  type ComplexityReport,
  type ComplexityReportFunctionEntry,
  formatComplexityComparisonLocation,
  formatComplexityDelta,
  formatComplexityFunctionLocation,
  formatComplexityScoreBandLabel,
  getComplexityHeadlineScore,
  isComplexityFunctionEntry,
} from "./complexity-report.js";
import { resolveMeasureWidth } from "./resolve-measure-width.js";

const BRANDED_INDENT = "  ";
const TABLE_GAP = "  ";
const SCORE_DECIMAL_PLACES = 2;
const FULL_MODE_METRIC_LABELS: ReadonlyArray<string> = ["cyc", "cog", "nest"];
const DIFF_MODE_METRIC_LABELS: ReadonlyArray<string> = ["Δcyc", "Δcog", "essential", "bloat"];

interface TableLayout {
  readonly metricWidths: ReadonlyArray<number>;
  readonly functionWidth: number;
  readonly locationWidth: number;
}

interface CellWidthInput {
  readonly label: string;
  readonly values: ReadonlyArray<string>;
}

const indentLine = (line: string): string => `${BRANDED_INDENT}${line}`;

const truncateVisibleText = (text: string, width: number): string => {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  if (width === 1) return "…";
  return `${text.slice(0, width - 1)}…`;
};

const truncateLeftVisibleText = (text: string, width: number): string => {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  if (width === 1) return "…";
  return `…${text.slice(-(width - 1))}`;
};

const padLeft = (text: string, width: number): string =>
  truncateVisibleText(text, width).padStart(width);
const padRight = (text: string, width: number): string =>
  truncateVisibleText(text, width).padEnd(width);

const formatCompactNumber = (value: number): string => {
  const roundedValue = Math.round(value * 100) / 100;
  return roundedValue
    .toFixed(2)
    .replace(/\.0+$/, "")
    .replace(/\.([1-9])0$/, ".$1");
};

const formatCompactRatio = (value: number): string => `${formatCompactNumber(value)}×`;

const formatCountSegment = (count: number, singular: string, plural: string): string =>
  `${highlighter.info(`${count}`)} ${highlighter.dim(count === 1 ? singular : plural)}`;

const formatMetricPiece = (label: string, value: string): string =>
  `${highlighter.dim(label)} ${highlighter.info(value)}`;

const formatHeadlineScore = (score: number, isDiffMode: boolean): string => {
  const clampedScore = Math.max(0, Math.min(1, score));
  const scoreHealth = 100 * (1 - clampedScore);
  const scoreText = colorizeByScore(clampedScore.toFixed(SCORE_DECIMAL_PLACES), scoreHealth);
  const scoreBand = colorizeByScore(
    formatComplexityScoreBandLabel(clampedScore, isDiffMode),
    scoreHealth,
  );
  const scoreBar = buildMeterBar({
    fraction: clampedScore,
    width: COMPLEXITY_SCORE_BAR_WIDTH_CHARS,
    colorizeFilled: (barText) => colorizeByScore(barText, scoreHealth),
  });
  return `${scoreText} ${highlighter.dim("/ 1.00")}  ${scoreBar}  ${scoreBand}`;
};

const resolveTableLayout = (
  metricInputs: ReadonlyArray<CellWidthInput>,
  preferredFunctionWidth: number,
  preferredLocationWidth: number,
): TableLayout => {
  const metricWidths = metricInputs.map(({ label, values }) =>
    Math.max(label.length, ...values.map((value) => value.length)),
  );
  const availableWidth = resolveMeasureWidth(BRANDED_INDENT.length);
  const fixedWidth = metricWidths.reduce((totalWidth, metricWidth) => totalWidth + metricWidth, 0);
  const separatorWidth = TABLE_GAP.length * (metricWidths.length + 1);
  const remainingWidth = Math.max(0, availableWidth - fixedWidth - separatorWidth);
  const preferredFunction = Math.max(
    preferredFunctionWidth,
    COMPLEXITY_TABLE_MIN_FUNCTION_WIDTH_CHARS,
  );
  const preferredLocation = Math.max(
    preferredLocationWidth,
    COMPLEXITY_TABLE_MIN_LOCATION_WIDTH_CHARS,
  );
  const locationWidth = Math.max(
    COMPLEXITY_TABLE_MIN_LOCATION_WIDTH_CHARS,
    Math.min(
      preferredLocation,
      Math.max(
        COMPLEXITY_TABLE_MIN_LOCATION_WIDTH_CHARS,
        remainingWidth - COMPLEXITY_TABLE_MIN_FUNCTION_WIDTH_CHARS,
      ),
    ),
  );
  const functionWidth = Math.max(
    COMPLEXITY_TABLE_MIN_FUNCTION_WIDTH_CHARS,
    Math.min(
      preferredFunction,
      Math.max(COMPLEXITY_TABLE_MIN_FUNCTION_WIDTH_CHARS, remainingWidth - locationWidth),
    ),
  );
  return {
    metricWidths,
    functionWidth,
    locationWidth,
  };
};

const renderTableHeader = (labels: ReadonlyArray<string>, layout: TableLayout): string => {
  const cells = labels.map((label, index) => padLeft(label, layout.metricWidths[index] ?? 0));
  cells.push(padRight("function", layout.functionWidth));
  cells.push(padRight("location", layout.locationWidth));
  return indentLine(highlighter.dim(cells.join(TABLE_GAP)));
};

const renderMetricCell = (value: string, width: number): string =>
  highlighter.info(padLeft(value, width));

const renderLocationCell = (location: string, width: number): string =>
  highlighter.info(truncateLeftVisibleText(location, width).padEnd(width));

const renderBloatCell = (bloatRatio: number | null, width: number): string =>
  highlighter.info(padLeft(bloatRatio === null ? "—" : formatCompactRatio(bloatRatio), width));

const renderFunctionCell = (
  label: string,
  width: number,
  status: ComplexityFunctionDelta["status"] | "full",
): string => {
  const formattedLabel =
    status === "added" ? `+ ${label}` : status === "removed" ? `- ${label}` : label;
  const paddedLabel = padRight(formattedLabel, width);
  if (status === "added") return highlighter.success(paddedLabel);
  if (status === "removed") return highlighter.error(paddedLabel);
  if (status === "changed") return highlighter.warn(paddedLabel);
  return highlighter.info(paddedLabel);
};

const formatFullFunctionLabel = (functionEntry: ComplexityFunctionEntry): string =>
  functionEntry.name;

const formatDiffFunctionLabel = (comparison: ComplexityFunctionDelta): string => {
  const displayFunction = comparison.head ?? comparison.base;
  if (displayFunction === null) return "<unknown>";
  return displayFunction.name;
};

const isComplexityFunctionDelta = (
  entry: ComplexityReportFunctionEntry,
): entry is ComplexityFunctionDelta => "status" in entry;

const sliceVisibleFunctions = <T extends ComplexityFunctionEntry | ComplexityFunctionDelta>(
  functions: ReadonlyArray<T>,
  top: number | null,
): ReadonlyArray<T> => (top === null ? functions : functions.slice(0, top));

const buildFullRows = (report: ComplexityReport): string[] => {
  const visibleFunctions = sliceVisibleFunctions(
    report.functions.filter(
      (functionEntry): functionEntry is ComplexityFunctionEntry =>
        isComplexityFunctionEntry(functionEntry) && functionEntry.name !== "<module>",
    ),
    report.top,
  );
  const functionLabels = visibleFunctions.map(formatFullFunctionLabel);
  const locationLabels = visibleFunctions.map(formatComplexityFunctionLocation);
  const layout = resolveTableLayout(
    [
      {
        label: FULL_MODE_METRIC_LABELS[0],
        values: visibleFunctions.map((functionEntry) => `${functionEntry.cyclomatic}`),
      },
      {
        label: FULL_MODE_METRIC_LABELS[1],
        values: visibleFunctions.map((functionEntry) => `${functionEntry.cognitive}`),
      },
      {
        label: FULL_MODE_METRIC_LABELS[2],
        values: visibleFunctions.map((functionEntry) => `${functionEntry.maxNestingDepth}`),
      },
    ],
    Math.max(
      COMPLEXITY_TABLE_MIN_FUNCTION_WIDTH_CHARS,
      ...functionLabels.map((label) => label.length),
    ),
    Math.max(
      COMPLEXITY_TABLE_MIN_LOCATION_WIDTH_CHARS,
      ...locationLabels.map((location) => location.length),
    ),
  );

  const rows = visibleFunctions.map((functionEntry) =>
    indentLine(
      [
        renderMetricCell(`${functionEntry.cyclomatic}`, layout.metricWidths[0] ?? 0),
        renderMetricCell(`${functionEntry.cognitive}`, layout.metricWidths[1] ?? 0),
        renderMetricCell(`${functionEntry.maxNestingDepth}`, layout.metricWidths[2] ?? 0),
        renderFunctionCell(formatFullFunctionLabel(functionEntry), layout.functionWidth, "full"),
        renderLocationCell(formatComplexityFunctionLocation(functionEntry), layout.locationWidth),
      ].join(TABLE_GAP),
    ),
  );

  return [renderTableHeader(FULL_MODE_METRIC_LABELS, layout), ...rows];
};

const buildDiffCallout = (functions: ReadonlyArray<ComplexityFunctionDelta>): string | null => {
  const changedFunctions = functions.filter((comparison) => comparison.status === "changed");
  const changedWithRawLines = changedFunctions.filter(
    (comparison) => comparison.rawLinesChanged !== null,
  );
  if (changedWithRawLines.length === 0) return null;

  const sortedFunctions = changedWithRawLines.slice().sort((firstComparison, secondComparison) => {
    const firstBloatRatio = firstComparison.bloatRatio ?? 0;
    const secondBloatRatio = secondComparison.bloatRatio ?? 0;
    if (firstBloatRatio !== secondBloatRatio) return secondBloatRatio - firstBloatRatio;
    if (firstComparison.rawLinesChanged !== secondComparison.rawLinesChanged) {
      return (secondComparison.rawLinesChanged ?? 0) - (firstComparison.rawLinesChanged ?? 0);
    }
    return secondComparison.essentialChange - firstComparison.essentialChange;
  });
  const mostBloatedFunction = sortedFunctions[0];
  if (!mostBloatedFunction) return null;

  const mostBloatedRatio = mostBloatedFunction.bloatRatio ?? 0;
  const isMeaningfulBloat =
    mostBloatedRatio >= COMPLEXITY_DIFF_CALLOUT_MIN_BLOAT_RATIO ||
    (mostBloatedFunction.essentialChange <=
      COMPLEXITY_DIFF_CALLOUT_PURE_CHURN_MAX_ESSENTIAL_CHANGE &&
      (mostBloatedFunction.rawLinesChanged ?? 0) >= COMPLEXITY_DIFF_CALLOUT_MIN_RAW_LINES_CHANGED);
  if (!isMeaningfulBloat) return null;

  const displayFunction = mostBloatedFunction.head ?? mostBloatedFunction.base;
  const functionLabel = displayFunction === null ? "<unknown>" : displayFunction.name;
  const essentialChangeLabel =
    mostBloatedFunction.essentialChange <= COMPLEXITY_DIFF_CALLOUT_PURE_CHURN_MAX_ESSENTIAL_CHANGE
      ? "~0"
      : formatCompactNumber(mostBloatedFunction.essentialChange);
  const rawLinesLabel = `${formatCompactNumber(mostBloatedFunction.rawLinesChanged ?? 0)} lines`;
  return indentLine(
    `${highlighter.warn("⚠")} ${highlighter.bold(functionLabel)}: wrote ${highlighter.info(rawLinesLabel)} for ${highlighter.info(`${essentialChangeLabel} structural change`)} (pure churn)`,
  );
};

const buildDiffRows = (report: ComplexityReport): string[] => {
  const visibleFunctions = sliceVisibleFunctions(
    report.functions.filter(
      (functionEntry): functionEntry is ComplexityFunctionDelta =>
        isComplexityFunctionDelta(functionEntry) && functionEntry.name !== "<module>",
    ),
    report.top,
  );
  const functionLabels = visibleFunctions.map(formatDiffFunctionLabel);
  const locationLabels = visibleFunctions.map(formatComplexityComparisonLocation);
  const layout = resolveTableLayout(
    [
      {
        label: DIFF_MODE_METRIC_LABELS[0],
        values: visibleFunctions.map((comparison) =>
          formatComplexityDelta(comparison.cyclomaticDelta),
        ),
      },
      {
        label: DIFF_MODE_METRIC_LABELS[1],
        values: visibleFunctions.map((comparison) =>
          formatComplexityDelta(comparison.cognitiveDelta),
        ),
      },
      {
        label: DIFF_MODE_METRIC_LABELS[2],
        values: visibleFunctions.map((comparison) =>
          formatCompactNumber(comparison.essentialChange),
        ),
      },
      {
        label: DIFF_MODE_METRIC_LABELS[3],
        values: visibleFunctions.map((comparison) =>
          comparison.bloatRatio === null ? "—" : formatCompactRatio(comparison.bloatRatio),
        ),
      },
    ],
    Math.max(
      COMPLEXITY_TABLE_MIN_FUNCTION_WIDTH_CHARS,
      ...functionLabels.map((label) => label.length),
    ),
    Math.max(
      COMPLEXITY_TABLE_MIN_LOCATION_WIDTH_CHARS,
      ...locationLabels.map((location) => location.length),
    ),
  );

  const rows = visibleFunctions.map((comparison) =>
    indentLine(
      [
        renderMetricCell(
          formatComplexityDelta(comparison.cyclomaticDelta),
          layout.metricWidths[0] ?? 0,
        ),
        renderMetricCell(
          formatComplexityDelta(comparison.cognitiveDelta),
          layout.metricWidths[1] ?? 0,
        ),
        renderMetricCell(
          formatCompactNumber(comparison.essentialChange),
          layout.metricWidths[2] ?? 0,
        ),
        renderBloatCell(comparison.bloatRatio, layout.metricWidths[3] ?? 0),
        renderFunctionCell(
          formatDiffFunctionLabel(comparison),
          layout.functionWidth,
          comparison.status,
        ),
        renderLocationCell(formatComplexityComparisonLocation(comparison), layout.locationWidth),
      ].join(TABLE_GAP),
    ),
  );

  const lines = [renderTableHeader(DIFF_MODE_METRIC_LABELS, layout), ...rows];
  const callout = buildDiffCallout(visibleFunctions);
  if (callout !== null) lines.push(callout);
  return lines;
};

const formatFullReport = (report: ComplexityReport, title: string): string[] => [
  indentLine(highlighter.bold(title)),
  "",
  indentLine(formatHeadlineScore(getComplexityHeadlineScore(report), false)),
  indentLine(
    `${formatCountSegment(report.summary.filesAnalyzed, "file", "files")} ${highlighter.dim("·")} ${formatCountSegment(report.summary.totalFunctions, "function", "functions")}`,
  ),
  "",
  buildSectionDivider(),
  indentLine(highlighter.bold("Most complex functions")),
  ...buildFullRows(report),
];

const formatDiffReport = (report: ComplexityReport): string[] => {
  const diffSummary = report.diff;
  if (!diffSummary) return formatFullReport(report, "React Doctor · Complexity");

  const requestedBaseRef = diffSummary.requestedBaseRef ?? diffSummary.baseRef;
  if (diffSummary.computed === false) {
    const lines = formatFullReport(report, `React Doctor · Complexity vs ${requestedBaseRef}`);
    if (diffSummary.note) lines.splice(4, 0, indentLine(highlighter.dim(diffSummary.note)));
    return lines;
  }

  const changedCount = diffSummary.functions.filter(
    (comparison) => comparison.status === "changed",
  ).length;
  return [
    indentLine(highlighter.bold(`React Doctor · Complexity vs ${requestedBaseRef}`)),
    "",
    indentLine(formatHeadlineScore(getComplexityHeadlineScore(report), true)),
    indentLine(
      `${formatMetricPiece("net cyclomatic", formatComplexityDelta(diffSummary.netCyclomaticChange))} ${highlighter.dim("·")} ${formatCountSegment(changedCount, "changed", "changed")} ${highlighter.dim("·")} ${formatCountSegment(diffSummary.addedCount, "added", "added")} ${highlighter.dim("·")} ${formatCountSegment(diffSummary.removedCount, "removed", "removed")} ${highlighter.dim("·")} ${formatMetricPiece("entropy", diffSummary.normalizedChangeEntropy.toFixed(SCORE_DECIMAL_PLACES))}`,
    ),
    "",
    buildSectionDivider(),
    indentLine(highlighter.bold("Changed functions")),
    indentLine(highlighter.dim("bloat = raw lines ÷ real change")),
    ...buildDiffRows(report),
  ];
};

export const renderComplexityReport = (report: ComplexityReport): string =>
  (report.mode === "diff"
    ? formatDiffReport(report)
    : formatFullReport(report, "React Doctor · Complexity")
  ).join("\n");
