import { describe, expect, it } from "vite-plus/test";
import { shouldEnableRuleByDefaultStatus } from "../src/utils/should-enable-rule-by-default-status.js";

describe("shouldEnableRuleByDefaultStatus", () => {
  it("keeps default rules enabled", () => {
    expect(
      shouldEnableRuleByDefaultStatus({
        defaultEnabled: true,
        includeTagDefaults: false,
        hasIncludedTags: false,
      }),
    ).toBe(true);
  });

  it("requires both tag-default mode and an included tag for opt-in rules", () => {
    expect(
      shouldEnableRuleByDefaultStatus({
        defaultEnabled: false,
        includeTagDefaults: true,
        hasIncludedTags: false,
      }),
    ).toBe(false);
    expect(
      shouldEnableRuleByDefaultStatus({
        defaultEnabled: false,
        includeTagDefaults: false,
        hasIncludedTags: true,
      }),
    ).toBe(false);
    expect(
      shouldEnableRuleByDefaultStatus({
        defaultEnabled: false,
        includeTagDefaults: true,
        hasIncludedTags: true,
      }),
    ).toBe(true);
  });

  it("lets explicit rule configuration enable an opt-in rule", () => {
    expect(
      shouldEnableRuleByDefaultStatus({
        defaultEnabled: false,
        includeTagDefaults: false,
        hasIncludedTags: false,
        hasExplicitOverride: true,
      }),
    ).toBe(true);
  });
});
