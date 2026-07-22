import { getSkillAgentConfig } from "agent-install";
import { Box, Text, useInput } from "ink";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { TUI_MODAL_FOOTER_ROWS, TUI_MODAL_MIN_BODY_ROWS } from "../../utils/constants.js";
import { copyToClipboard, type CliAgentId } from "../../utils/launch-agent.js";
import { useScrollViewport } from "../hooks/use-scroll-viewport.js";
import { useStdoutDimensions } from "../hooks/use-stdout-dimensions.js";
import { buildDiagnosticListEntries } from "../lib/diagnostic-list-entries.js";
import type { DiagnosticListEntry } from "../lib/diagnostic-list-entries.js";
import { buildIssuePrompt } from "../lib/build-issue-prompt.js";
import type { DiagnosticRow } from "../lib/diagnostic-rows.js";
import type { TuiHandoffRequest } from "../scan-store.js";
import { DiagnosticActionMenu } from "./diagnostic-action-menu.js";
import { DiagnosticDetail } from "./diagnostic-detail.js";
import { DiagnosticItem } from "./diagnostic-item.js";
import { StatusBar } from "./status-bar.js";

export type DiagnosticListLayout = "split" | "stacked";

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
  readonly launchableAgents: ReadonlyArray<CliAgentId>;
  readonly onHandoff?: (request: TuiHandoffRequest) => void;
  readonly canAddToCi?: boolean;
  readonly onAddToCi?: () => void;
  readonly projectCount?: number;
  readonly onExit: () => void;
  readonly exitHint?: string;
}

const ADD_TO_CI_KEY = "a";
const sumSites = (rows: ReadonlyArray<DiagnosticRow>): number =>
  rows.reduce((total, row) => total + row.siteCount, 0);

const renderEntry = (
  entry: DiagnosticListEntry,
  entryIndex: number,
  selectedIndex: number,
  readRuleKeys: ReadonlySet<string>,
): ReactNode => {
  if (entry.kind === "header") {
    return (
      <Text key={`header:${entry.category}`} bold wrap="truncate-end">
        {entry.category}
      </Text>
    );
  }
  return (
    <DiagnosticItem
      key={entry.row.ruleKey}
      row={entry.row}
      isSelected={entryIndex === selectedIndex}
      isRead={readRuleKeys.has(entry.row.ruleKey)}
    />
  );
};

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
  launchableAgents,
  onHandoff,
  canAddToCi,
  onAddToCi,
  projectCount,
  onExit,
  exitHint,
}: DiagnosticListProps) => {
  const entries = useMemo(() => buildDiagnosticListEntries(rows), [rows]);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [menuIndex, setMenuIndex] = useState(0);

  const isSplit = layout === "split";
  const { rows: terminalRows } = useStdoutDimensions();

  const { selectedIndex, visibleStart, visibleEnd } = useScrollViewport({
    itemCount: entries.length,
    height: listHeight,
    isSelectable: (index) => entries[index]?.kind === "item",
    isActive: !isMenuOpen,
  });

  const visibleEntries = entries.slice(visibleStart, visibleEnd);
  const selectedEntry = entries[selectedIndex];
  const selected = selectedEntry?.kind === "item" ? selectedEntry.row : null;
  const selectedRuleKey = selected?.ruleKey ?? null;

  const [readRuleKeys, setReadRuleKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [copiedRuleKey, setCopiedRuleKey] = useState<string | null>(null);

  const menuLabels = useMemo(
    () => [
      "Copy prompt",
      ...launchableAgents.map((agentId) => getSkillAgentConfig(agentId).displayName),
    ],
    [launchableAgents],
  );

  useEffect(() => {
    if (!selectedRuleKey) return;
    setReadRuleKeys((previous) =>
      previous.has(selectedRuleKey) ? previous : new Set(previous).add(selectedRuleKey),
    );
  }, [selectedRuleKey]);

  const copySelectedPrompt = (): void => {
    if (!selected) return;
    const prompt = buildIssuePrompt({ row: selected, projectName });
    const ruleKey = selected.ruleKey;
    void copyToClipboard(prompt).then((didCopy) => {
      if (didCopy) setCopiedRuleKey(ruleKey);
    });
  };

  const launchSelectedInAgent = (agentId: CliAgentId): void => {
    if (!selected || !onHandoff) return;
    onHandoff({ agentId, prompt: buildIssuePrompt({ row: selected, projectName }) });
    onExit();
  };

  const runMenuItem = (): void => {
    if (menuIndex === 0) {
      copySelectedPrompt();
      setIsMenuOpen(false);
      return;
    }
    const agentId = launchableAgents[menuIndex - 1];
    if (agentId) launchSelectedInAgent(agentId);
  };

  const showCiCallout = Boolean(canAddToCi && onAddToCi);

  useInput(
    (input, key) => {
      if (input === "q" || key.escape) return onExit();
      if (showCiCallout && input === ADD_TO_CI_KEY) {
        onAddToCi?.();
        return onExit();
      }
      if (key.return && selected) {
        setMenuIndex(0);
        setIsMenuOpen(true);
      }
    },
    { isActive: !isMenuOpen },
  );

  useInput(
    (input, key) => {
      if (key.escape) return setIsMenuOpen(false);
      if (key.upArrow || input === "k") {
        return setMenuIndex((index) => Math.max(0, index - 1));
      }
      if (key.downArrow || input === "j") {
        return setMenuIndex((index) => Math.min(menuLabels.length - 1, index + 1));
      }
      if (key.return) return runMenuItem();
    },
    { isActive: isMenuOpen },
  );

  const errorRows = rows.filter((row) => row.severity === "error");
  const warningRows = rows.filter((row) => row.severity === "warning");
  const itemPosition = entries
    .slice(0, selectedIndex + 1)
    .filter((entry) => entry.kind === "item").length;
  const unreadCount = rows.length - rows.filter((row) => readRuleKeys.has(row.ruleKey)).length;

  const listColumn = (
    <Box flexDirection="column" height={listHeight} width={isSplit ? listColumnWidth : width}>
      {visibleEntries.map((entry, index) =>
        renderEntry(entry, visibleStart + index, selectedIndex, readRuleKeys),
      )}
    </Box>
  );

  const detailContent = (
    <>
      <DiagnosticDetail row={selected} rootDirectory={rootDirectory} />
      {copiedRuleKey === selectedRuleKey ? (
        <Box marginTop={1}>
          <Text color="green">✓ Copied fix prompt</Text>
        </Box>
      ) : null}
    </>
  );

  const keyHints = useMemo(
    () =>
      isMenuOpen ? (
        <>
          <Text dimColor>↑/↓ select · </Text>
          <Text color="cyan">enter</Text>
          <Text dimColor> run · esc close</Text>
        </>
      ) : (
        <>
          <Text dimColor>↑/↓ move · </Text>
          <Text color="cyan">enter</Text>
          <Text dimColor> fix this</Text>
          {showCiCallout ? (
            <>
              <Text dimColor> · </Text>
              <Text color="green">{ADD_TO_CI_KEY}</Text>
              <Text dimColor> add CI</Text>
            </>
          ) : null}
        </>
      ),
    [isMenuOpen, showCiCallout],
  );

  const statusBar = (
    <Box marginTop={1}>
      <StatusBar
        total={sumSites(rows)}
        errorCount={sumSites(errorRows)}
        warningCount={sumSites(warningRows)}
        position={rows.length === 0 ? 0 : itemPosition}
        groupCount={rows.length}
        unreadCount={unreadCount}
        projectCount={projectCount}
        keyHints={keyHints}
        exitHint={exitHint}
      />
    </Box>
  );

  const overlay =
    isMenuOpen && selected ? (
      <Box
        position="absolute"
        top={0}
        left={0}
        width={width}
        height={Math.max(TUI_MODAL_MIN_BODY_ROWS, terminalRows - TUI_MODAL_FOOTER_ROWS)}
        justifyContent="center"
        alignItems="center"
      >
        <DiagnosticActionMenu
          title={selected.title}
          itemLabels={menuLabels}
          focusedIndex={menuIndex}
          maxWidth={width}
        />
      </Box>
    ) : null;

  if (isSplit) {
    return (
      <Box flexDirection="column" width={width} position="relative">
        <Box flexDirection="row">
          <Box flexDirection="column" width={listColumnWidth} marginRight={1}>
            {header}
            <Box marginTop={1}>{listColumn}</Box>
          </Box>
          <Box
            flexDirection="column"
            width={detailColumnWidth}
            borderStyle="single"
            borderColor="gray"
            borderTop={false}
            borderRight={false}
            borderBottom={false}
            paddingLeft={1}
            height={detailHeight}
            overflowY="hidden"
          >
            {detailContent}
          </Box>
        </Box>
        {statusBar}
        {overlay}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} position="relative">
      {header}
      <Box marginTop={1}>{listColumn}</Box>
      <Text dimColor>{"─".repeat(width)}</Text>
      <Box flexDirection="column" height={detailHeight} overflowY="hidden">
        {detailContent}
      </Box>
      {statusBar}
      {overlay}
    </Box>
  );
};
