import { describe, expect, it } from "vite-plus/test";
import { buildRulePromptUrl, PROMPTS_RULES_BASE_URL } from "@react-doctor/core";

describe("buildRulePromptUrl", () => {
  it("builds the canonical per-rule fix-recipe URL from plugin and rule", () => {
    expect(buildRulePromptUrl("react-doctor", "no-array-index-key")).toBe(
      `${PROMPTS_RULES_BASE_URL}/react-doctor/no-array-index-key.md`,
    );
  });

  it("preserves non-react-doctor plugin namespaces", () => {
    expect(buildRulePromptUrl("jsx-a11y", "alt-text")).toBe(
      "https://www.react.doctor/prompts/rules/jsx-a11y/alt-text.md",
    );
  });
});
