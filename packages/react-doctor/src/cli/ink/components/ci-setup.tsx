import { Box, Text } from "ink";
import { GITHUB_ACTIONS_SETUP_URL } from "@react-doctor/core";
import { TUI_REPORT_ACTION_MENU_MARGIN_ROWS } from "../../utils/constants.js";
import { CiJustification } from "./ci-justification.js";
import { ActionMenu } from "./action-menu.js";
import type { ActionMenuAction } from "./action-menu.js";
import { TuiLink } from "./tui-link.js";

export interface CiSetupFeedback {
  readonly didSucceed: boolean;
  readonly message: string;
}

export interface CiSetupProps {
  readonly feedback?: CiSetupFeedback;
  readonly onConfirm: () => void;
  readonly onLearnMore: () => void;
  readonly onBack: () => void;
  readonly onQuit: () => void;
}

export const CiSetup = ({ feedback, onConfirm, onLearnMore, onBack, onQuit }: CiSetupProps) => {
  const actions: ReadonlyArray<ActionMenuAction> = [
    {
      id: "confirm",
      label: "Yes, add the workflow",
      onSelect: onConfirm,
    },
    {
      id: "learn-more",
      label: "Open the GitHub Actions guide",
      onSelect: onLearnMore,
    },
  ];

  return (
    <Box flexDirection="column">
      <Text bold>
        <Text color="cyan">?</Text> Add React Doctor to GitHub Actions?
      </Text>
      <CiJustification />
      <ActionMenu actions={actions} onEscape={onBack} onQuit={onQuit} />
      {feedback ? (
        <Text color={feedback.didSucceed ? "green" : "yellow"}>
          {feedback.didSucceed ? (
            feedback.message
          ) : (
            <TuiLink url={GITHUB_ACTIONS_SETUP_URL}>{feedback.message}</TuiLink>
          )}
        </Text>
      ) : null}
      <Box marginTop={TUI_REPORT_ACTION_MENU_MARGIN_ROWS}>
        <Text dimColor>↑/↓ move · enter select · esc back · q quit</Text>
      </Box>
    </Box>
  );
};
