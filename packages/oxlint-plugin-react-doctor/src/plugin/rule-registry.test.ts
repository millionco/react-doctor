import { describe, expect, it } from "vite-plus/test";
import { ALL_REACT_DOCTOR_RULE_KEYS, REACT_NATIVE_RULES } from "../rules.js";
import { ruleRegistry } from "./rule-registry.js";

const RETIRED_REANIMATED_LAYOUT_RULE_ID = "rn-animate-layout-property";
const RETIRED_REANIMATED_LAYOUT_RULE_KEY = "react-doctor/rn-animate-layout-property";

describe("rule registry", () => {
  it("keeps the retired Reanimated layout-property rule resolvable but default-off", () => {
    expect(ruleRegistry[RETIRED_REANIMATED_LAYOUT_RULE_ID]?.lifecycle).toBe("retired");
    expect(ruleRegistry[RETIRED_REANIMATED_LAYOUT_RULE_ID]?.defaultEnabled).toBe(false);
    expect(ALL_REACT_DOCTOR_RULE_KEYS.has(RETIRED_REANIMATED_LAYOUT_RULE_KEY)).toBe(true);
    expect(REACT_NATIVE_RULES[RETIRED_REANIMATED_LAYOUT_RULE_KEY]).toBeUndefined();
  });
});
