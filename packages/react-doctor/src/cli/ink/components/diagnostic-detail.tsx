import { getCategoryImpact } from "@react-doctor/core";
import { Box, Text } from "ink";
import { useMemo } from "react";
import { buildCodeFrame } from "../../utils/build-code-frame.js";
import { TUI_DETAIL_INDENT_COLUMNS } from "../../utils/constants.js";
import type { DiagnosticRow } from "../lib/diagnostic-rows.js";
import { severityVariant } from "../lib/severity-variants.js";

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
        <Text color={variant.color}>
          {"  "}
          {variant.icon}{" "}
        </Text>
        <Text color={variant.color} bold>
          {row.title}
        </Text>
        {row.siteCount > 1 ? <Text dimColor> ×{row.siteCount}</Text> : null}
      </Text>
      <Box flexDirection="column" paddingLeft={TUI_DETAIL_INDENT_COLUMNS}>
        <Text dimColor wrap="truncate-end">
          {row.category} · {variant.label}
        </Text>
        {impact ? (
          <Text dimColor wrap="wrap">
            {impact}
          </Text>
        ) : null}
        <Text wrap="wrap">{representative.message}</Text>
        <Text dimColor wrap="truncate-end">
          {row.location}
        </Text>
      </Box>
      {codeFrame ? (
        <Box
          marginTop={1}
          marginLeft={TUI_DETAIL_INDENT_COLUMNS}
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          alignSelf="flex-start"
        >
          <Text>{codeFrame}</Text>
        </Box>
      ) : null}
      {representative.help ? (
        <Box marginTop={1} paddingLeft={TUI_DETAIL_INDENT_COLUMNS}>
          <Text dimColor wrap="wrap">
            → {representative.help}
          </Text>
        </Box>
      ) : null}
      {row.learnMore ? (
        <Box marginTop={1} paddingLeft={TUI_DETAIL_INDENT_COLUMNS}>
          <Text color="cyan" wrap="truncate-end">
            {row.learnMore}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
};
