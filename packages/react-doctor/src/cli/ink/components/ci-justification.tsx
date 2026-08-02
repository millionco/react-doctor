import { Box, Text } from "ink";
import { CI_TRUST_COMPANIES, TUI_HORIZONTAL_PADDING_COLUMNS } from "../../utils/constants.js";

export const CiJustification = () => (
  <Box flexDirection="column" paddingLeft={TUI_HORIZONTAL_PADDING_COLUMNS}>
    <Text dimColor>
      Scan every pull request to prevent new React issues while you fix the backlog.
    </Text>
    <Text dimColor>Adds a workflow file and a `doctor` package script.</Text>
    <Text dimColor>Used by teams at {CI_TRUST_COMPANIES}.</Text>
  </Box>
);
