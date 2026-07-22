import { Box, Text } from "ink";
import {
  TUI_HORIZONTAL_PADDING_COLUMNS,
  TUI_MODAL_MIN_WIDTH_CHARS,
  TUI_MODAL_TARGET_WIDTH_CHARS,
} from "../../utils/constants.js";

export interface DiagnosticActionMenuProps {
  readonly title: string;
  readonly itemLabels: ReadonlyArray<string>;
  readonly focusedIndex: number;
  readonly maxWidth: number;
}

export const DiagnosticActionMenu = ({
  title,
  itemLabels,
  focusedIndex,
  maxWidth,
}: DiagnosticActionMenuProps) => {
  const width = Math.max(
    TUI_MODAL_MIN_WIDTH_CHARS,
    Math.min(TUI_MODAL_TARGET_WIDTH_CHARS, maxWidth),
  );
  return (
    <Box
      width={width}
      borderStyle="round"
      borderColor="cyan"
      paddingX={TUI_HORIZONTAL_PADDING_COLUMNS}
      paddingY={1}
      flexDirection="column"
    >
      <Text wrap="truncate-end">
        <Text dimColor>Fix </Text>
        <Text bold>{title}</Text>
      </Text>
      <Box marginTop={1} flexDirection="column">
        {itemLabels.map((label, index) => {
          const isFocused = index === focusedIndex;
          return (
            <Text
              key={label}
              wrap="truncate-end"
              bold={isFocused}
              color={isFocused ? "cyan" : undefined}
              dimColor={!isFocused}
            >
              {isFocused ? "› " : "  "}
              {label}
            </Text>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor wrap="truncate-end">
          ↑/↓ select · enter run · esc close
        </Text>
      </Box>
    </Box>
  );
};
