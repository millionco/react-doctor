import { Text } from "ink";
import type { DiagnosticRow } from "../lib/diagnostic-rows.js";
import { severityVariant } from "../lib/severity-variants.js";

export interface DiagnosticItemProps {
  readonly row: DiagnosticRow;
  readonly isSelected: boolean;
  readonly isRead: boolean;
}

export const DiagnosticItem = ({ row, isSelected, isRead }: DiagnosticItemProps) => {
  const variant = severityVariant(row.severity);
  const shouldHighlightSeverity = isSelected || !isRead;
  let marker = "• ";
  if (isRead) marker = "  ";
  if (isSelected) marker = "› ";
  let markerColor = shouldHighlightSeverity ? variant.color : undefined;
  if (isSelected) markerColor = "cyan";

  return (
    <Text wrap="truncate-end" dimColor={isRead && !isSelected}>
      <Text color={markerColor}>{marker}</Text>
      <Text color={shouldHighlightSeverity ? variant.color : undefined}>{`${variant.icon} `}</Text>
      <Text color={shouldHighlightSeverity ? variant.color : undefined} bold={isSelected}>
        {row.title}
      </Text>
      {row.siteCount > 1 ? <Text dimColor> ×{row.siteCount}</Text> : null}
    </Text>
  );
};
