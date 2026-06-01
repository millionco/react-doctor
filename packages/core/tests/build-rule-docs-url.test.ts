import { describe, expect, it } from "vite-plus/test";
import { buildRuleDocsUrl, DOCS_RULES_BASE_URL } from "@react-doctor/core";

describe("buildRuleDocsUrl", () => {
  it("builds the canonical per-rule docs URL from plugin and rule", () => {
    expect(buildRuleDocsUrl("react-doctor", "no-array-index-key")).toBe(
      `${DOCS_RULES_BASE_URL}/react-doctor/no-array-index-key`,
    );
  });

  it("preserves non-react-doctor plugin namespaces", () => {
    expect(buildRuleDocsUrl("jsx-a11y", "anchor-is-valid")).toBe(
      "https://www.react.doctor/docs/rules/jsx-a11y/anchor-is-valid",
    );
  });
});
