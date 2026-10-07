import { Box, Text } from "ink";
import {
  TUI_HORIZONTAL_PADDING_COLUMNS,
  TUI_REPORT_ACTION_MENU_MARGIN_ROWS,
} from "../../utils/constants.js";
import { ActionMenu } from "./action-menu.js";
import type { ActionMenuAction } from "./action-menu.js";
import { CiJustification } from "./ci-justification.js";

export interface HandoffCiRecommendationProps {
  readonly onAddToCi: () => void;
  readonly onContinue: () => void;
  readonly onQuit: () => void;
}

export const HandoffCiRecommendation = ({
  onAddToCi,
  onContinue,
  onQuit,
}: HandoffCiRecommendationProps) => {
  const actions: ReadonlyArray<ActionMenuAction> = [
    {
      id: "add-to-ci",
      label: "Add to GitHub Actions first (Recommended)",
      onSelect: onAddToCi,
    },
    { id: "continue", label: "Continue without GitHub Actions", onSelect: onContinue },
  ];

  return (
    <Box flexDirection="column">
      <Box paddingLeft={TUI_HORIZONTAL_PADDING_COLUMNS}>
        <Text bold>Add React Doctor to GitHub Actions first</Text>
      </Box>
      <CiJustification />
      <ActionMenu actions={actions} onEscape={onContinue} onQuit={onQuit} />
      <Box marginTop={TUI_REPORT_ACTION_MENU_MARGIN_ROWS}>
        <Text dimColor>↑/↓ move · enter select · esc skip · q quit</Text>
      </Box>
    </Box>
  );
};
