import { describe, expect, it } from "vite-plus/test";
import { ALL_REACT_DOCTOR_RULE_KEYS, REACT_NATIVE_RULES } from "../rules.js";
import { ruleRegistry } from "./rule-registry.js";

const RETIRED_REANIMATED_LAYOUT_RULE_KEY = "react-doctor/rn-animate-layout-property";

describe("rule registry", () => {
  it("does not register the retired Reanimated layout-property rule", () => {
    expect(ruleRegistry[RETIRED_REANIMATED_LAYOUT_RULE_KEY]).toBeUndefined();
    expect(ALL_REACT_DOCTOR_RULE_KEYS.has(RETIRED_REANIMATED_LAYOUT_RULE_KEY)).toBe(false);
    expect(REACT_NATIVE_RULES[RETIRED_REANIMATED_LAYOUT_RULE_KEY]).toBeUndefined();
  });
});
