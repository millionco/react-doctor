import { describe, expect, it } from "vite-plus/test";
import type { RuleSeverityControls } from "@react-doctor/core";
import { resolveRuleSeverityOverride } from "@react-doctor/core";

describe("resolveRuleSeverityOverride", () => {
  it("returns undefined when no controls are configured", () => {
    expect(
      resolveRuleSeverityOverride(
        { ruleKey: "react-doctor/no-array-index-as-key", category: "Correctness" },
        undefined,
      ),
    ).toBeUndefined();
  });

  it("returns the per-rule override when one matches", () => {
    const controls: RuleSeverityControls = {
      rules: { "react-doctor/no-array-index-as-key": "warn" },
    };
    expect(
      resolveRuleSeverityOverride(
        { ruleKey: "react-doctor/no-array-index-as-key", category: "Correctness" },
        controls,
      ),
    ).toBe("warn");
  });

  it("prefers per-rule over per-category", () => {
    const controls: RuleSeverityControls = {
      rules: { "react-doctor/example-rule": "error" },
      categories: { Architecture: "warn" },
    };
    expect(
      resolveRuleSeverityOverride(
        { ruleKey: "react-doctor/example-rule", category: "Architecture" },
        controls,
      ),
    ).toBe("error");
  });

  it("falls back to category when no rule key matches", () => {
    const controls: RuleSeverityControls = { categories: { Server: "warn" } };
    expect(
      resolveRuleSeverityOverride(
        { ruleKey: "react-doctor/server-auth-actions", category: "Server" },
        controls,
      ),
    ).toBe("warn");
  });

  it("returns undefined when neither channel matches the rule", () => {
    const controls: RuleSeverityControls = {
      rules: { "react-doctor/other-rule": "error" },
      categories: { Security: "warn" },
    };
    expect(
      resolveRuleSeverityOverride(
        { ruleKey: "react-doctor/no-array-index-as-key", category: "Correctness" },
        controls,
      ),
    ).toBeUndefined();
  });

  it("ignores a category lookup when input has no category", () => {
    const controls: RuleSeverityControls = { categories: { Server: "warn" } };
    expect(resolveRuleSeverityOverride({ ruleKey: "react-doctor/foo" }, controls)).toBeUndefined();
  });
});
