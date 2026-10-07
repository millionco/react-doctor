import { Box, Text } from "ink";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vite-plus/test";
import { severityVariant } from "../../src/cli/ink/lib/severity-variants.js";

describe("ink toolchain", () => {
  it("renders JSX to a frame", () => {
    const { lastFrame } = render(
      <Box>
        <Text color={severityVariant("error").color}>
          {severityVariant("error").icon} hello doctor
        </Text>
      </Box>,
    );
    expect(lastFrame()).toContain("hello doctor");
  });
});
