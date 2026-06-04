import { describe, expect, it } from "vite-plus/test";
import { ruleRegistry } from "./rule-registry.js";

const REANIMATED_LAYOUT_RULE_ID = "rn-animate-layout-property";

describe("rule registry", () => {
  it("keeps the Reanimated layout-property rule retired", () => {
    expect(ruleRegistry[REANIMATED_LAYOUT_RULE_ID]?.lifecycle).toBe("retired");
    expect(ruleRegistry[REANIMATED_LAYOUT_RULE_ID]?.defaultEnabled).toBe(false);
  });
});
