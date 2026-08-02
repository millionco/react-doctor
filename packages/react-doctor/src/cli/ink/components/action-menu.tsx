import figures from "figures";
import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { ReactNode } from "react";
import {
  TUI_REPORT_ACTION_MENU_ITEM_GAP_ROWS,
  TUI_REPORT_ACTION_MENU_MARGIN_ROWS,
} from "../../utils/constants.js";

export interface ActionMenuAction {
  readonly id: string;
  readonly label: string;
  readonly description?: ReactNode;
  readonly onSelect: () => void;
}

export interface ActionMenuProps {
  readonly actions: ReadonlyArray<ActionMenuAction>;
  readonly selectedIndex?: number;
  readonly onSelectionChange?: (index: number) => void;
  readonly onEscape: () => void;
  readonly onQuit: () => void;
}

export const ActionMenu = ({
  actions,
  selectedIndex: controlledSelectedIndex,
  onSelectionChange,
  onEscape,
  onQuit,
}: ActionMenuProps) => {
  const [internalSelectedIndex, setInternalSelectedIndex] = useState(0);
  const selectedIndex = controlledSelectedIndex ?? internalSelectedIndex;
  const changeSelection = onSelectionChange ?? setInternalSelectedIndex;

  useInput((input, key) => {
    if (input === "q") return onQuit();
    if (key.escape) return onEscape();
    if (actions.length === 0) return;
    if (key.upArrow || input === "k") {
      return changeSelection(Math.max(0, selectedIndex - 1));
    }
    if (key.downArrow || input === "j") {
      return changeSelection(Math.min(actions.length - 1, selectedIndex + 1));
    }
    if (key.return) actions[selectedIndex]?.onSelect();
  });

  return (
    <Box flexDirection="column" marginTop={TUI_REPORT_ACTION_MENU_MARGIN_ROWS}>
      {actions.map((action, index) => {
        const isSelected = index === selectedIndex;
        return (
          <Box
            key={action.id}
            flexDirection="column"
            marginBottom={
              index < actions.length - 1 ? TUI_REPORT_ACTION_MENU_ITEM_GAP_ROWS : undefined
            }
          >
            <Text color={isSelected ? "cyan" : undefined} bold={isSelected}>
              {isSelected ? figures.pointer : figures.pointerSmall} {action.label}
            </Text>
            {isSelected ? action.description : null}
          </Box>
        );
      })}
    </Box>
  );
};
