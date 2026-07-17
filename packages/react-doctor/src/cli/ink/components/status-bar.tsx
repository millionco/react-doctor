import { Text } from "ink";
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
}: StatusBarProps) => (
  <Text wrap="truncate-end">
    <Text bold>
      {total} {total === 1 ? "issue" : "issues"}
    </Text>
    <Text dimColor> › </Text>
    <Text color="red">{errorCount} errors</Text>
    <Text dimColor>, </Text>
    <Text color="yellow" dimColor>
      {warningCount} warnings
    </Text>
    {unreadCount !== undefined ? (
      <Text color={unreadCount > 0 ? "cyan" : undefined} dimColor={unreadCount === 0}>
        {" · "}
        {unreadCount} unread
      </Text>
    ) : null}
    {projectCount !== undefined ? (
      <Text dimColor>
        {" · "}
        {projectCount} {projectCount === 1 ? "project" : "projects"}
      </Text>
    ) : null}
    <Text dimColor>
      {"   "}
      {position}/{groupCount} · {keyHints} · {exitHint}
    </Text>
  </Text>
);
