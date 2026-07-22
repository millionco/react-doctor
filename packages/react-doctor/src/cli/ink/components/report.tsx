import { Box, Text, useInput } from "ink";
import { useMemo } from "react";
import type { ScoreResult } from "@react-doctor/core";
import type { CliAgentId } from "../../utils/launch-agent.js";
import {
  TUI_REPORT_COLUMN_GUTTER_COLUMNS,
  TUI_REPORT_DETAIL_ROWS,
  TUI_REPORT_DETAIL_WIDTH_FRACTION,
  TUI_REPORT_DIVIDER_ROWS,
  TUI_REPORT_HEADER_ROWS,
  TUI_HORIZONTAL_PADDING_COLUMNS,
  TUI_REPORT_LIST_MARGIN_ROWS,
  TUI_REPORT_MIN_COLUMN_WIDTH_CHARS,
  TUI_REPORT_MIN_LIST_ROWS,
  TUI_REPORT_MIN_WIDTH_CHARS,
  TUI_REPORT_STATUS_ROWS,
  TUI_REPORT_WIDE_MIN_COLUMNS,
  TUI_REPORT_WIDE_MIN_ROWS,
} from "../../utils/constants.js";
import type { ScanReport, TuiHandoffRequest } from "../scan-store.js";
import { useStdoutDimensions } from "../hooks/use-stdout-dimensions.js";
import { buildDiagnosticRows } from "../lib/diagnostic-rows.js";
import { DiagnosticList } from "./diagnostic-list.js";
import { ScoreHeader } from "./score-header.js";

export interface ReportProps {
  readonly report: ScanReport;
  readonly onExit: () => void;
  readonly launchableAgents?: ReadonlyArray<CliAgentId>;
  readonly onHandoff?: (request: TuiHandoffRequest) => void;
  readonly canAddToCi?: boolean;
  readonly onAddToCi?: () => void;
  readonly projectCount?: number;
  readonly priorityScores?: ReadonlyArray<ScoreResult | null>;
  readonly exitHint?: string;
}

const STACKED_FIXED_ROWS =
  TUI_REPORT_HEADER_ROWS +
  TUI_REPORT_LIST_MARGIN_ROWS +
  TUI_REPORT_DIVIDER_ROWS +
  TUI_REPORT_STATUS_ROWS;
const SPLIT_CHROME_ROWS =
  TUI_REPORT_HEADER_ROWS + TUI_REPORT_LIST_MARGIN_ROWS + TUI_REPORT_STATUS_ROWS;
const EMPTY_LAUNCHABLE_AGENTS: ReadonlyArray<CliAgentId> = [];

export const Report = ({
  report,
  onExit,
  launchableAgents = EMPTY_LAUNCHABLE_AGENTS,
  onHandoff,
  canAddToCi,
  onAddToCi,
  projectCount,
  priorityScores,
  exitHint = "q to quit",
}: ReportProps) => {
  const { rows: terminalRows, columns } = useStdoutDimensions();
  const diagnosticRows = useMemo(
    () => buildDiagnosticRows(report.diagnostics, priorityScores ?? [report.score]),
    [report.diagnostics, report.score, priorityScores],
  );

  useInput(
    (input, key) => {
      if (input === "q" || key.escape) onExit();
    },
    { isActive: diagnosticRows.length === 0 },
  );

  const width = Math.max(TUI_REPORT_MIN_WIDTH_CHARS, columns - TUI_HORIZONTAL_PADDING_COLUMNS);
  const isWide = columns >= TUI_REPORT_WIDE_MIN_COLUMNS && terminalRows >= TUI_REPORT_WIDE_MIN_ROWS;
  const detailHeight = isWide
    ? Math.max(0, terminalRows - TUI_REPORT_STATUS_ROWS)
    : Math.max(
        0,
        Math.min(
          TUI_REPORT_DETAIL_ROWS,
          terminalRows - STACKED_FIXED_ROWS - TUI_REPORT_MIN_LIST_ROWS,
        ),
      );
  const listHeight = Math.max(
    TUI_REPORT_MIN_LIST_ROWS,
    terminalRows - (isWide ? SPLIT_CHROME_ROWS : STACKED_FIXED_ROWS + detailHeight),
  );
  const detailColumnWidth = Math.max(
    TUI_REPORT_MIN_COLUMN_WIDTH_CHARS,
    Math.floor(width * TUI_REPORT_DETAIL_WIDTH_FRACTION),
  );
  const listColumnWidth = Math.max(
    TUI_REPORT_MIN_COLUMN_WIDTH_CHARS,
    width - detailColumnWidth - TUI_REPORT_COLUMN_GUTTER_COLUMNS,
  );

  const scoreHeader = (
    <ScoreHeader
      score={report.score}
      projectedScore={report.projectedScore}
      projectName={report.projectName}
      issueCount={report.diagnostics.length}
      noScoreMessage={report.noScoreMessage}
      width={isWide ? listColumnWidth : width}
    />
  );

  if (diagnosticRows.length === 0) {
    const lintFailureReason = report.lintFailureReason;
    return (
      <Box flexDirection="column">
        {scoreHeader}
        <Box marginTop={1}>
          {lintFailureReason ? (
            <Text color="yellow">⚠ Lint did not run: {lintFailureReason}</Text>
          ) : (
            <Text color="green">✔ No issues found. Nice work.</Text>
          )}
        </Box>
        <Text dimColor>{exitHint}</Text>
      </Box>
    );
  }

  return (
    <DiagnosticList
      header={scoreHeader}
      rows={diagnosticRows}
      width={width}
      listColumnWidth={listColumnWidth}
      detailColumnWidth={detailColumnWidth}
      listHeight={listHeight}
      detailHeight={detailHeight}
      layout={isWide ? "split" : "stacked"}
      rootDirectory={report.rootDirectory}
      projectName={report.projectName}
      launchableAgents={launchableAgents}
      onHandoff={onHandoff}
      canAddToCi={canAddToCi}
      onAddToCi={onAddToCi}
      projectCount={projectCount}
      onExit={onExit}
      exitHint={exitHint}
    />
  );
};
