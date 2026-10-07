import { getSkillAgentConfig } from "agent-install";
import { Box, Text } from "ink";
import {
  TUI_HORIZONTAL_PADDING_COLUMNS,
  TUI_REPORT_ACTION_MENU_MARGIN_ROWS,
} from "../../utils/constants.js";
import type { CliAgentId } from "../../utils/launch-agent.js";
import { ActionMenu } from "./action-menu.js";
import type { ActionMenuAction } from "./action-menu.js";

export interface AgentHandoffProps {
  readonly agents: ReadonlyArray<CliAgentId>;
  readonly onSelect: (agentId: CliAgentId) => void;
  readonly onCopyPrompt: () => void;
  readonly onBack: () => void;
  readonly onQuit: () => void;
}

export const AgentHandoff = ({
  agents,
  onSelect,
  onCopyPrompt,
  onBack,
  onQuit,
}: AgentHandoffProps) => {
  const actions: ReadonlyArray<ActionMenuAction> = [
    ...agents.map((agentId) => ({
      id: agentId,
      label: getSkillAgentConfig(agentId).displayName,
      onSelect: () => onSelect(agentId),
    })),
    {
      id: "copy-prompt",
      label: "Copy prompt",
      description: <Text dimColor>Paste into any agent or edit it first</Text>,
      onSelect: onCopyPrompt,
    },
  ];

  return (
    <Box flexDirection="column">
      <Box paddingLeft={TUI_HORIZONTAL_PADDING_COLUMNS}>
        <Text bold>Choose how to continue</Text>
      </Box>
      <ActionMenu actions={actions} onEscape={onBack} onQuit={onQuit} />
      <Box marginTop={TUI_REPORT_ACTION_MENU_MARGIN_ROWS}>
        <Text dimColor>↑/↓ move · enter select · esc back · q quit</Text>
      </Box>
    </Box>
  );
};
