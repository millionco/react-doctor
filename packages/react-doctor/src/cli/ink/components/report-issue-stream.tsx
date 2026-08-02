import { Box, Text } from "ink";
import { OUTPUT_MEASURE_WIDTH_CHARS } from "@react-doctor/core";
import { TUI_REPORT_ISSUE_STREAM_VISIBLE_ROWS } from "../../utils/constants.js";
import type { DiagnosticRow } from "../lib/diagnostic-rows.js";
import { severityVariant } from "../lib/severity-variants.js";

export interface ReportIssueStreamProps {
  readonly rows: ReadonlyArray<DiagnosticRow>;
  readonly selectedIndex: number;
  readonly width: number;
}

export const ReportIssueStream = ({ rows, selectedIndex, width }: ReportIssueStreamProps) => {
  const visibleRowCount = Math.min(rows.length, TUI_REPORT_ISSUE_STREAM_VISIBLE_ROWS);
  const visibleRows = Array.from({ length: visibleRowCount }, (_, visibleRowIndex) => {
    const rowIndex =
      (selectedIndex - visibleRowCount + visibleRowIndex + 1 + rows.length) % rows.length;
    return { row: rows[rowIndex], rowIndex };
  });
  const contentWidth = Math.min(width, OUTPUT_MEASURE_WIDTH_CHARS);

  return (
    <Box flexDirection="column" width={contentWidth}>
      <Text bold>Reviewing issues</Text>
      {visibleRows.map(({ row, rowIndex }) => {
        if (!row) return null;
        const variant = severityVariant(row.severity);
        const isSelected = rowIndex === selectedIndex;
        return (
          <Text key={row.ruleKey} dimColor={!isSelected} wrap="truncate-end">
            <Text color={isSelected ? variant.color : undefined}>{isSelected ? "›" : " "} </Text>
            <Text color={isSelected ? variant.color : undefined} bold={isSelected}>
              {row.category}: {row.title}
            </Text>
            {row.siteCount > 1 ? <Text dimColor> ×{row.siteCount}</Text> : null}
          </Text>
        );
      })}
    </Box>
  );
};
