import { Box, Text, useInput } from "ink";
import type { ReactNode } from "react";
import { TUI_REPORT_ACTION_MENU_MARGIN_ROWS } from "../../utils/constants.js";
import { formatSkippedCheckLabel } from "../../utils/format-skipped-check-label.js";
import type { ReportReveal } from "../hooks/use-report-reveal.js";
import { ActionMenu } from "./action-menu.js";
import type { ActionMenuAction } from "./action-menu.js";

export interface ReportLandingProps {
  readonly header: ReactNode;
  readonly phase: ReportReveal["phase"];
  readonly issueCount: number;
  readonly emptyStateMessage?: string;
  readonly lintFailureReason?: string;
  readonly skippedChecks?: ReadonlyArray<string>;
  readonly incompleteMessage?: string;
  readonly actions: ReadonlyArray<ActionMenuAction>;
  readonly selectedIndex: number;
  readonly onSelectionChange: (index: number) => void;
  readonly onQuit: () => void;
}

interface ReportStatusProps {
  readonly issueCount: number;
  readonly emptyStateMessage?: string;
  readonly lintFailureReason?: string;
  readonly skippedChecks?: ReadonlyArray<string>;
  readonly incompleteMessage?: string;
}

const ReportStatus = ({
  issueCount,
  emptyStateMessage,
  lintFailureReason,
  skippedChecks,
  incompleteMessage,
}: ReportStatusProps) => {
  const skippedCheckLabel = skippedChecks
    ?.flatMap((skippedCheck) =>
      skippedCheck === "lint" && lintFailureReason ? [] : [formatSkippedCheckLabel(skippedCheck)],
    )
    .join(" and ");
  const hasIncompleteResult = Boolean(incompleteMessage || lintFailureReason || skippedCheckLabel);
  if (!hasIncompleteResult && issueCount > 0) return null;

  return (
    <Box flexDirection="column" marginTop={TUI_REPORT_ACTION_MENU_MARGIN_ROWS}>
      {incompleteMessage ? <Text color="yellow">⚠ {incompleteMessage}</Text> : null}
      {lintFailureReason ? (
        <Text color="yellow">⚠ Lint did not run: {lintFailureReason}</Text>
      ) : null}
      {skippedCheckLabel ? (
        <Text color="yellow">
          ⚠ {issueCount === 0 ? "No issues detected, but " : ""}
          {skippedCheckLabel} checks failed — results are incomplete.
        </Text>
      ) : null}
      {issueCount === 0 && !hasIncompleteResult ? (
        <Text color="green">✔ {emptyStateMessage ?? "No issues found. Nice work."}</Text>
      ) : null}
    </Box>
  );
};

export const ReportLanding = ({
  header,
  phase,
  issueCount,
  emptyStateMessage,
  lintFailureReason,
  skippedChecks,
  incompleteMessage,
  actions,
  selectedIndex,
  onSelectionChange,
  onQuit,
}: ReportLandingProps) => {
  const showScore = phase === "actions" || phase === "score";
  useInput(
    (input) => {
      if (input === "q") onQuit();
    },
    { isActive: phase !== "actions" },
  );

  return (
    <Box flexDirection="column">
      {showScore ? header : null}
      <ReportStatus
        issueCount={issueCount}
        emptyStateMessage={emptyStateMessage}
        lintFailureReason={lintFailureReason}
        skippedChecks={skippedChecks}
        incompleteMessage={incompleteMessage}
      />
      {phase === "actions" ? (
        <>
          <ActionMenu
            actions={actions}
            selectedIndex={selectedIndex}
            onSelectionChange={onSelectionChange}
            onEscape={onQuit}
            onQuit={onQuit}
          />
          <Box marginTop={TUI_REPORT_ACTION_MENU_MARGIN_ROWS}>
            <Text dimColor>
              {actions.length === 0 ? "q quit" : "↑/↓ move · enter select · q quit"}
            </Text>
          </Box>
        </>
      ) : null}
    </Box>
  );
};
