import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { pluralize } from "../../utils/pluralize.js";

export interface StatusBarProps {
  readonly total: number;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly position: number;
  readonly issueCount: number;
  readonly unreadCount?: number;
  readonly projectCount?: number;
  readonly keyHints?: ReactNode;
  readonly exitHint?: string;
  readonly compact?: boolean;
}

export const StatusBar = ({
  total,
  errorCount,
  warningCount,
  position,
  issueCount,
  unreadCount,
  projectCount,
  keyHints = <Text dimColor>↑/↓ to move</Text>,
  exitHint = "q to quit",
  compact = false,
}: StatusBarProps) => {
  const counts = (
    <>
      <Text bold>{pluralize(total, "finding")}</Text>
      <Text dimColor>{"  "}</Text>
      <Text color="red">{pluralize(errorCount, "error")}</Text>
      <Text dimColor>{"  "}</Text>
      <Text color="yellow">{pluralize(warningCount, "warning")}</Text>
    </>
  );

  if (compact)
    return (
      <Text wrap="truncate-end">
        {counts}
        <Text dimColor>
          {"  ·  "}
          issue {position}/{issueCount}
          {"  ·  "}
        </Text>
        {keyHints}
        <Text dimColor> · {exitHint}</Text>
      </Text>
    );

  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        {counts}
        <Text dimColor>
          {"  ·  "}
          issue {position}/{issueCount}
        </Text>
        {projectCount !== undefined ? (
          <Text dimColor>
            {"  ·  "}
            {pluralize(projectCount, "project")}
          </Text>
        ) : null}
      </Text>
      <Text wrap="truncate-end">
        {unreadCount !== undefined ? (
          <Text color={unreadCount > 0 ? "cyan" : undefined} dimColor={unreadCount === 0}>
            {pluralize(unreadCount, "issue")} unread{"  ·  "}
          </Text>
        ) : null}
        {keyHints}
        <Text dimColor> · {exitHint}</Text>
      </Text>
    </Box>
  );
};
