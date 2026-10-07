import { getCategoryImpact } from "@react-doctor/core";
import { Box, Text } from "ink";
import { buildCodeFrame } from "../../utils/build-code-frame.js";
import { TUI_DETAIL_INDENT_COLUMNS, TUI_REPORT_SECTION_GAP_ROWS } from "../../utils/constants.js";
import type { DiagnosticRow } from "../lib/diagnostic-rows.js";
import { useMemo } from "../react-runtime.js";
import { severityVariant } from "../lib/severity-variants.js";
import { TuiLink } from "./tui-link.js";

export interface DiagnosticDetailProps {
  readonly row: DiagnosticRow | null;
  readonly rootDirectory: string;
}

export const DiagnosticDetail = ({ row, rootDirectory }: DiagnosticDetailProps) => {
  const codeFrame = useMemo(() => {
    if (!row) return null;
    const { representative } = row;
    return buildCodeFrame({
      filePath: representative.filePath,
      line: representative.line,
      column: representative.column,
      rootDirectory,
    });
  }, [row, rootDirectory]);

  if (!row) return null;
  const variant = severityVariant(row.severity);
  const { representative } = row;
  const impact = getCategoryImpact(row.category);

  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        <Text color={variant.color}>{variant.icon} </Text>
        <Text color={variant.color} bold>
          {row.title}
        </Text>
        {row.siteCount > 1 ? <Text dimColor> ×{row.siteCount}</Text> : null}
      </Text>
      <Box flexDirection="column" paddingLeft={TUI_DETAIL_INDENT_COLUMNS}>
        <Text dimColor wrap="truncate-end">
          {row.category} · {variant.label} · {row.location}
          {representative.fileContext ? ` · ${representative.fileContext} file` : ""}
        </Text>
        {impact ? (
          <Box marginTop={TUI_REPORT_SECTION_GAP_ROWS}>
            <Text wrap="wrap">
              <Text color="cyan">Impact </Text>
              {impact}
            </Text>
          </Box>
        ) : null}
        <Box marginTop={TUI_REPORT_SECTION_GAP_ROWS}>
          <Text wrap="wrap">
            <Text color="cyan">Why </Text>
            {representative.message}
          </Text>
        </Box>
        {codeFrame ? (
          <Box marginTop={TUI_REPORT_SECTION_GAP_ROWS}>
            <Text>{codeFrame}</Text>
          </Box>
        ) : null}
        {representative.help ? (
          <Box marginTop={TUI_REPORT_SECTION_GAP_ROWS}>
            <Text wrap="wrap">
              <Text color="cyan">Fix </Text>
              {representative.help}
            </Text>
          </Box>
        ) : null}
        {row.ruleGuideUrl ? (
          <Box marginTop={TUI_REPORT_SECTION_GAP_ROWS}>
            <Text color="blue" wrap="truncate-end">
              <TuiLink url={row.ruleGuideUrl}>Rule guide: {row.ruleGuideUrl}</TuiLink>
            </Text>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
};
