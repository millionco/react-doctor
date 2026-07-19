// rule: ink-no-raw-text
// weakness: jsx-position
// source: RDE hyperdxio/hyperdx Ink CLI sample
import { Box, Text } from "ink";

export const PaddedBox = () => (
  <Box paddingX={1} paddingY={0}>
    <Text>Ready</Text>
  </Box>
);
