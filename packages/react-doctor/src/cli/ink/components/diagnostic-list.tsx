import { Box, Text, useInput } from "ink";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  METRIC,
  TUI_REPORT_LIST_MARGIN_ROWS,
  TUI_REPORT_SECTION_GAP_ROWS,
  TUI_REPORT_SPLIT_MARGIN_COLUMNS,
  TUI_REPORT_SPLIT_PADDING_COLUMNS,
} from "../../utils/constants.js";
import { copyToClipboard } from "../../utils/launch-agent.js";
import { recordCount } from "../../utils/record-metric.js";
import { useScrollViewport } from "../hooks/use-scroll-viewport.js";
import { buildIssuePrompt } from "../lib/build-issue-prompt.js";
import type { DiagnosticRow } from "../lib/diagnostic-rows.js";
import type { DiagnosticListLayout } from "../lib/resolve-report-layout.js";
import { DiagnosticDetail } from "./diagnostic-detail.js";
import { DiagnosticItem } from "./diagnostic-item.js";
import { StatusBar } from "./status-bar.js";

export interface DiagnosticListProps {
  readonly header: ReactNode;
  readonly rows: ReadonlyArray<DiagnosticRow>;
  readonly width: number;
  readonly listColumnWidth: number;
  readonly detailColumnWidth: number;
  readonly listHeight: number;
  readonly detailHeight: number;
  readonly layout: DiagnosticListLayout;
  readonly rootDirectory: string;
  readonly projectName: string;
  readonly projectCount?: number;
  readonly initialSelectedIndex: number;
  readonly readRuleKeys: ReadonlySet<string>;
  readonly onSelectedIndexChange: (index: number) => void;
  readonly onQuit: () => void;
  readonly onBack?: () => void;
  readonly exitHint?: string;
}

const DIAGNOSTIC_KEY_HINTS = (
  <>
    <Text dimColor>↑/↓ move · </Text>
    <Text color="cyan">enter</Text>
    <Text dimColor> copy context</Text>
  </>
);

export const DiagnosticList = ({
  header,
  rows,
  width,
  listColumnWidth,
  detailColumnWidth,
  listHeight,
  detailHeight,
  layout,
  rootDirectory,
  projectName,
  projectCount,
  initialSelectedIndex,
  readRuleKeys,
  onSelectedIndexChange,
  onQuit,
  onBack = onQuit,
  exitHint,
}: DiagnosticListProps) => {
  const isSplit = layout === "split";
  const isCompact = layout === "compact";

  const { selectedIndex, visibleStart, visibleEnd } = useScrollViewport({
    itemCount: rows.length,
    height: listHeight,
    initialSelectedIndex,
    onSelectedIndexChange,
  });

  const visibleRows = rows.slice(visibleStart, visibleEnd);
  const selected = rows[selectedIndex] ?? null;
  const selectedRuleKey = selected?.ruleKey ?? null;
  const initialSelectedRuleKey = useRef(selectedRuleKey);
  const didRecordFindingNavigation = useRef(false);

  const [copiedRuleKey, setCopiedRuleKey] = useState<string | null>(null);
  const [copyFailedRuleKey, setCopyFailedRuleKey] = useState<string | null>(null);
  const effectiveReadRuleKeys = useMemo(() => {
    if (!selectedRuleKey || readRuleKeys.has(selectedRuleKey)) return readRuleKeys;
    return new Set(readRuleKeys).add(selectedRuleKey);
  }, [readRuleKeys, selectedRuleKey]);

  useEffect(() => {
    if (
      !selectedRuleKey ||
      selectedRuleKey === initialSelectedRuleKey.current ||
      didRecordFindingNavigation.current
    )
      return;
    didRecordFindingNavigation.current = true;
    recordCount(METRIC.tuiFindingNavigated);
  }, [selectedRuleKey]);

  const copySelectedIssueContext = (): void => {
    if (!selected) return;
    const issuePrompt = buildIssuePrompt({ row: selected, projectName });
    const ruleKey = selected.ruleKey;
    void copyToClipboard(issuePrompt).then((didCopyIssueContext) => {
      if (didCopyIssueContext) {
        setCopiedRuleKey(ruleKey);
        setCopyFailedRuleKey(null);
        return;
      }
      recordCount(METRIC.tuiReportActionSelected, 1, { action: "copy-issue-context-failed" });
      setCopiedRuleKey(null);
      setCopyFailedRuleKey(ruleKey);
    });
  };

  useInput((input, key) => {
    if (input === "q") return onQuit();
    if (key.escape) return onBack();
    if (key.return && selected) {
      recordCount(METRIC.tuiReportActionSelected, 1, { action: "copy-issue-context" });
      copySelectedIssueContext();
    }
  });

  let totalFindingCount = 0;
  let errorFindingCount = 0;
  let warningFindingCount = 0;
  for (const row of rows) {
    totalFindingCount += row.siteCount;
    if (row.severity === "error") errorFindingCount += row.siteCount;
    else warningFindingCount += row.siteCount;
  }
  const selectedIssuePosition = rows.length === 0 ? 0 : selectedIndex + 1;
  const unreadIssueCount =
    rows.length - rows.filter((row) => effectiveReadRuleKeys.has(row.ruleKey)).length;

  const listColumn = (
    <Box flexDirection="column" height={listHeight} width={isSplit ? listColumnWidth : width}>
      {visibleRows.map((row, index) => {
        const rowIndex = visibleStart + index;
        return (
          <DiagnosticItem
            key={row.ruleKey}
            row={row}
            isSelected={rowIndex === selectedIndex}
            isRead={effectiveReadRuleKeys.has(row.ruleKey)}
          />
        );
      })}
    </Box>
  );

  let copyFeedback: ReactNode = null;
  if (copiedRuleKey === selectedRuleKey) {
    copyFeedback = (
      <Box marginTop={TUI_REPORT_SECTION_GAP_ROWS}>
        <Text color="green">✓ Copied issue context</Text>
      </Box>
    );
  } else if (copyFailedRuleKey === selectedRuleKey) {
    copyFeedback = (
      <Box marginTop={TUI_REPORT_SECTION_GAP_ROWS}>
        <Text color="yellow">Couldn't copy issue context. Press Enter to try again.</Text>
      </Box>
    );
  }
  const detailContent = (
    <>
      <DiagnosticDetail row={selected} rootDirectory={rootDirectory} />
      {copyFeedback}
    </>
  );

  let visibleKeyHints = DIAGNOSTIC_KEY_HINTS;
  if (isCompact && copiedRuleKey === selectedRuleKey) {
    visibleKeyHints = <Text color="green">✓ Copied issue context</Text>;
  } else if (isCompact && copyFailedRuleKey === selectedRuleKey) {
    visibleKeyHints = <Text color="yellow">Copy failed · enter retry</Text>;
  }
  const statusBar = (
    <Box marginTop={isCompact ? 0 : TUI_REPORT_SECTION_GAP_ROWS}>
      <StatusBar
        total={totalFindingCount}
        errorCount={errorFindingCount}
        warningCount={warningFindingCount}
        position={selectedIssuePosition}
        issueCount={rows.length}
        unreadCount={unreadIssueCount}
        projectCount={projectCount}
        keyHints={visibleKeyHints}
        exitHint={exitHint}
        compact={isCompact}
      />
    </Box>
  );

  if (isCompact) {
    return (
      <Box flexDirection="column" width={width}>
        {listColumn}
        {statusBar}
      </Box>
    );
  }

  if (isSplit) {
    return (
      <Box flexDirection="column" width={width}>
        <Box flexDirection="row" maxHeight={detailHeight} overflowY="hidden">
          <Box
            flexDirection="column"
            width={listColumnWidth}
            marginRight={TUI_REPORT_SPLIT_MARGIN_COLUMNS}
          >
            {header}
            <Box marginTop={TUI_REPORT_LIST_MARGIN_ROWS}>{listColumn}</Box>
          </Box>
          <Box
            flexDirection="column"
            width={detailColumnWidth}
            borderStyle="single"
            borderColor="gray"
            borderTop={false}
            borderRight={false}
            borderBottom={false}
            paddingLeft={TUI_REPORT_SPLIT_PADDING_COLUMNS}
            overflowY="hidden"
          >
            {detailContent}
          </Box>
        </Box>
        {statusBar}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width}>
      <Box marginTop={TUI_REPORT_LIST_MARGIN_ROWS}>{listColumn}</Box>
      <Text dimColor>{"─".repeat(width)}</Text>
      <Box flexDirection="column" maxHeight={detailHeight} overflowY="hidden">
        {detailContent}
      </Box>
      {statusBar}
    </Box>
  );
};
