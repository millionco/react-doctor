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

  return (
    <Text wrap="truncate-end" dimColor={isRead}>
      <Text color={isSelected ? variant.color : undefined}>{isSelected ? "›" : " "}</Text>
      <Text color={isRead ? undefined : variant.color}>{isRead ? "  " : " •"}</Text>
      <Text color={isRead ? undefined : variant.color}>{` ${variant.icon} `}</Text>
      <Text color={isRead ? undefined : variant.color} bold={isSelected}>
        {row.title}
      </Text>
      {row.siteCount > 1 ? <Text dimColor> ×{row.siteCount}</Text> : null}
    </Text>
  );
};
