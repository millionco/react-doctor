import { Box, Text, useInput } from "ink";
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
import { buildBatchedIssuePrompt } from "../lib/build-batched-issue-prompt.js";
import type { DiagnosticListEntry } from "../lib/diagnostic-list-entries.js";
import type { DiagnosticRow } from "../lib/diagnostic-rows.js";
import type { DiagnosticListLayout } from "../lib/resolve-report-layout.js";
import { useEffect, useMemo, useRef, useState } from "../react-runtime.js";
import { DiagnosticDetail } from "./diagnostic-detail.js";
import { DiagnosticItem } from "./diagnostic-item.js";
import { StatusBar } from "./status-bar.js";

export interface DiagnosticListProps {
  readonly header: ReactNode;
  readonly rows: ReadonlyArray<DiagnosticRow>;
  readonly entries: ReadonlyArray<DiagnosticListEntry>;
  readonly width: number;
  readonly listColumnWidth: number;
  readonly detailColumnWidth: number;
  readonly listHeight: number;
  readonly detailHeight: number;
  readonly layout: DiagnosticListLayout;
  readonly rootDirectory: string;
  readonly projectName: string;
  readonly projectCount?: number;
  readonly initialSelectedRowIndex: number | null;
  readonly readRuleKeys: ReadonlySet<string>;
  readonly onSelectedRowIndexChange: (index: number) => void;
  readonly onQuit: () => void;
  readonly onBack?: () => void;
  readonly exitHint?: string;
}

const DIAGNOSTIC_KEY_HINTS = (
  <>
    <Text dimColor>↑/↓ move · </Text>
    <Text color="cyan">space</Text>
    <Text dimColor> select · </Text>
    <Text color="cyan">enter</Text>
    <Text dimColor> copy</Text>
  </>
);

export const DiagnosticList = ({
  header,
  rows,
  entries,
  width,
  listColumnWidth,
  detailColumnWidth,
  listHeight,
  detailHeight,
  layout,
  rootDirectory,
  projectName,
  projectCount,
  initialSelectedRowIndex,
  readRuleKeys,
  onSelectedRowIndexChange,
  onQuit,
  onBack = onQuit,
  exitHint,
}: DiagnosticListProps) => {
  const isSplit = layout === "split";
  const isCompact = layout === "compact";
  const initialSelectedEntryIndex =
    initialSelectedRowIndex === null
      ? 0
      : Math.max(
          0,
          entries.findIndex(
            (entry) => entry.kind === "item" && entry.rowIndex === initialSelectedRowIndex,
          ),
        );

  const {
    selectedIndex: selectedEntryIndex,
    visibleStart: visibleEntryStart,
    visibleEnd: visibleEntryEnd,
  } = useScrollViewport({
    itemCount: entries.length,
    height: listHeight,
    initialSelectedIndex: initialSelectedEntryIndex,
    isSelectable: (entryIndex) => entries[entryIndex]?.kind === "item",
    onSelectedIndexChange: (entryIndex) => {
      const entry = entries[entryIndex];
      if (entry?.kind === "item") onSelectedRowIndexChange(entry.rowIndex);
    },
  });

  const visibleEntries = entries.slice(visibleEntryStart, visibleEntryEnd);
  const selectedEntry = entries[selectedEntryIndex];
  const selected = selectedEntry?.kind === "item" ? selectedEntry.row : null;
  const selectedRuleKey = selected?.ruleKey ?? null;
  const initialSelectedRuleKey = useRef(selectedRuleKey);
  const didRecordFindingNavigation = useRef(false);

  const [selectedRuleKeys, setSelectedRuleKeys] = useState<Set<string>>(new Set());
  const [copiedRuleKey, setCopiedRuleKey] = useState<string | null>(null);
  const [copiedBatchCount, setCopiedBatchCount] = useState<number>(0);
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

  const toggleSelection = (): void => {
    if (!selectedRuleKey) return;
    setSelectedRuleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(selectedRuleKey)) {
        next.delete(selectedRuleKey);
      } else {
        next.add(selectedRuleKey);
      }
      return next;
    });
  };

  const copySelectedIssueContext = (): void => {
    const rowsToCopy = selectedRuleKeys.size > 0
      ? rows.filter((row) => selectedRuleKeys.has(row.ruleKey))
      : selected
        ? [selected]
        : [];

    if (rowsToCopy.length === 0) return;

    const issuePrompt = rowsToCopy.length === 1
      ? buildIssuePrompt({ row: rowsToCopy[0]!, projectName })
      : buildBatchedIssuePrompt({ rows: rowsToCopy, projectName });

    const ruleKey = rowsToCopy.length === 1 ? rowsToCopy[0]!.ruleKey : null;
    const batchCount = rowsToCopy.length > 1 ? rowsToCopy.length : 0;
    
    void copyToClipboard(issuePrompt).then((didCopyIssueContext) => {
      if (didCopyIssueContext) {
        setCopiedRuleKey(ruleKey);
        setCopiedBatchCount(batchCount);
        setCopyFailedRuleKey(null);
        return;
      }
      recordCount(METRIC.tuiReportActionSelected, 1, { action: "copy-issue-context-failed" });
      setCopiedRuleKey(null);
      setCopiedBatchCount(0);
      setCopyFailedRuleKey(ruleKey);
    });
  };

  useInput((input, key) => {
    if (input === "q") return onQuit();
    if (key.escape) return onBack();
    if (input === " " && selected) {
      toggleSelection();
    }
    if (key.return && selected) {
      const action = selectedRuleKeys.size > 0 ? "copy-batched-issue-context" : "copy-issue-context";
      recordCount(METRIC.tuiReportActionSelected, 1, { action });
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
  const selectedIssuePosition = entries
    .slice(0, selectedEntryIndex + 1)
    .filter((entry) => entry.kind === "item").length;
  const unreadIssueCount =
    rows.length - rows.filter((row) => effectiveReadRuleKeys.has(row.ruleKey)).length;

  const listColumn = (
    <Box flexDirection="column" height={listHeight} width={isSplit ? listColumnWidth : width}>
      {visibleEntries.map((entry, index) => {
        const entryIndex = visibleEntryStart + index;
        if (entry.kind === "header") {
          return (
            <Text key={`header-${entry.category}`} bold>
              {entry.category}
            </Text>
          );
        }
        return (
          <DiagnosticItem
            key={entry.row.ruleKey}
            row={entry.row}
            isSelected={entryIndex === selectedEntryIndex}
            isRead={effectiveReadRuleKeys.has(entry.row.ruleKey)}
            isMarked={selectedRuleKeys.has(entry.row.ruleKey)}
          />
        );
      })}
    </Box>
  );

  let copyFeedback: ReactNode = null;
  const selectedCount = selectedRuleKeys.size;
  if (copiedRuleKey === selectedRuleKey || copiedBatchCount > 0) {
    const message = copiedBatchCount > 0 
      ? `✓ Copied ${copiedBatchCount} ${copiedBatchCount === 1 ? "issue" : "issues"} to clipboard`
      : "✓ Copied issue context";
    copyFeedback = (
      <Box marginTop={TUI_REPORT_SECTION_GAP_ROWS}>
        <Text color="green">{message}</Text>
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
  if (isCompact && (copiedRuleKey === selectedRuleKey || copiedBatchCount > 0)) {
    const message = copiedBatchCount > 0
      ? `✓ Copied ${copiedBatchCount} ${copiedBatchCount === 1 ? "issue" : "issues"}`
      : "✓ Copied issue context";
    visibleKeyHints = <Text color="green">{message}</Text>;
  } else if (isCompact && copyFailedRuleKey === selectedRuleKey) {
    visibleKeyHints = <Text color="yellow">Copy failed · enter retry</Text>;
  } else if (selectedCount > 0) {
    visibleKeyHints = (
      <>
        <Text dimColor>↑/↓ move · </Text>
        <Text color="cyan">space</Text>
        <Text dimColor> select · </Text>
        <Text color="cyan">enter</Text>
        <Text dimColor> copy </Text>
        <Text color="green">({selectedCount} selected)</Text>
      </>
    );
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
        {header}
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
      {header}
      <Box marginTop={TUI_REPORT_LIST_MARGIN_ROWS}>{listColumn}</Box>
      <Text dimColor>{"─".repeat(width)}</Text>
      <Box flexDirection="column" maxHeight={detailHeight} overflowY="hidden">
        {detailContent}
      </Box>
      {statusBar}
    </Box>
  );
};
