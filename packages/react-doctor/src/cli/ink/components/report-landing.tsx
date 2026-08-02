import { Box, Text, useInput } from "ink";
import type { ReactNode } from "react";
import { TUI_REPORT_ACTION_MENU_MARGIN_ROWS } from "../../utils/constants.js";
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
  readonly actions: ReadonlyArray<ActionMenuAction>;
  readonly selectedIndex: number;
  readonly onSelectionChange: (index: number) => void;
  readonly onQuit: () => void;
}

export const ReportLanding = ({
  header,
  phase,
  issueCount,
  emptyStateMessage,
  lintFailureReason,
  skippedChecks,
  actions,
  selectedIndex,
  onSelectionChange,
  onQuit,
}: ReportLandingProps) => {
  const showScore = phase === "actions" || phase === "score";
  const skippedCheckLabel = skippedChecks?.join(" and ");
  useInput(
    (input) => {
      if (input === "q") onQuit();
    },
    { isActive: phase !== "actions" },
  );

  return (
    <Box flexDirection="column">
      {showScore ? header : null}
      {issueCount === 0 ? (
        <Box marginTop={TUI_REPORT_ACTION_MENU_MARGIN_ROWS}>
          {lintFailureReason ? (
            <Text color="yellow">⚠ Lint did not run: {lintFailureReason}</Text>
          ) : skippedCheckLabel ? (
            <Text color="yellow">
              ⚠ No issues detected, but {skippedCheckLabel} checks failed — results are incomplete.
            </Text>
          ) : (
            <Text color="green">✔ {emptyStateMessage ?? "No issues found. Nice work."}</Text>
          )}
        </Box>
      ) : null}
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
