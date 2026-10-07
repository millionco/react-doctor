import { GITHUB_ACTIONS_SETUP_URL } from "@react-doctor/core";
import { Box, Text } from "ink";
import { CI_TRUST_COMPANIES, TUI_HORIZONTAL_PADDING_COLUMNS } from "../../utils/constants.js";
import { TuiLink } from "./tui-link.js";

export const CiJustification = () => (
  <Box flexDirection="column" paddingLeft={TUI_HORIZONTAL_PADDING_COLUMNS}>
    <Text dimColor>
      Scan every pull request to prevent new React issues while you fix the backlog.
    </Text>
    <Text dimColor>Used by teams at {CI_TRUST_COMPANIES}.</Text>
    <TuiLink url={GITHUB_ACTIONS_SETUP_URL}>
      <Text color="cyan">{GITHUB_ACTIONS_SETUP_URL}</Text>
    </TuiLink>
  </Box>
);
