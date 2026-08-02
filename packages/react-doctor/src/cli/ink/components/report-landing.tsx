import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { TUI_REPORT_ACTION_MENU_MARGIN_ROWS } from "../../utils/constants.js";
import type { ReportReveal } from "../hooks/use-report-reveal.js";
import { ActionMenu } from "./action-menu.js";
import type { ActionMenuAction } from "./action-menu.js";

export interface ReportLandingProps {
  readonly header: ReactNode;
  readonly phase: ReportReveal["phase"];
  readonly issueCount: number;
  readonly lintFailureReason?: string;
  readonly actions: ReadonlyArray<ActionMenuAction>;
  readonly selectedIndex: number;
  readonly onSelectionChange: (index: number) => void;
  readonly onExit: () => void;
  readonly onQuit: () => void;
}

export const ReportLanding = ({
  header,
  phase,
  issueCount,
  lintFailureReason,
  actions,
  selectedIndex,
  onSelectionChange,
  onExit,
  onQuit,
}: ReportLandingProps) => {
  const showScore = phase === "actions" || phase === "score";

  return (
    <Box flexDirection="column">
      {showScore ? header : null}
      {issueCount === 0 ? (
        <Box marginTop={TUI_REPORT_ACTION_MENU_MARGIN_ROWS}>
          {lintFailureReason ? (
            <Text color="yellow">⚠ Lint did not run: {lintFailureReason}</Text>
          ) : (
            <Text color="green">✔ No issues found. Nice work.</Text>
          )}
        </Box>
      ) : null}
      {phase === "actions" ? (
        <>
          <ActionMenu
            actions={actions}
            selectedIndex={selectedIndex}
            onSelectionChange={onSelectionChange}
            onEscape={onExit}
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
