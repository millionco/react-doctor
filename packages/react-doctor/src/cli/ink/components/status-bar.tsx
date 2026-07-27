import { Box, Text } from "ink";
import type { ReactNode } from "react";

export interface StatusBarProps {
  readonly total: number;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly position: number;
  readonly groupCount: number;
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
  groupCount,
  unreadCount,
  projectCount,
  keyHints = <Text dimColor>↑/↓ to move</Text>,
  exitHint = "q to quit",
  compact = false,
}: StatusBarProps) => {
  const counts = (
    <>
      <Text bold>
        {total} {total === 1 ? "issue" : "issues"}
      </Text>
      <Text dimColor>{"  "}</Text>
      <Text color="red">{errorCount} errors</Text>
      <Text dimColor>{"  "}</Text>
      <Text color="yellow">{warningCount} warnings</Text>
    </>
  );

  if (compact)
    return (
      <Text wrap="truncate-end">
        {counts}
        <Text dimColor>
          {"  ·  "}
          {position}/{groupCount}
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
          {position}/{groupCount}
        </Text>
        {projectCount !== undefined ? (
          <Text dimColor>
            {"  ·  "}
            {projectCount} {projectCount === 1 ? "project" : "projects"}
          </Text>
        ) : null}
      </Text>
      <Text wrap="truncate-end">
        {unreadCount !== undefined ? (
          <Text color={unreadCount > 0 ? "cyan" : undefined} dimColor={unreadCount === 0}>
            {unreadCount} unread{"  ·  "}
          </Text>
        ) : null}
        {keyHints}
        <Text dimColor> · {exitHint}</Text>
      </Text>
    </Box>
  );
};
