import { describe, expect, it } from "vite-plus/test";
import { ALL_REACT_DOCTOR_RULE_KEYS, REACT_NATIVE_RULES } from "../rules.js";
import { ruleRegistry } from "./rule-registry.js";

const REANIMATED_LAYOUT_RULE_ID = "rn-animate-layout-property";
const REANIMATED_LAYOUT_RULE_KEY = "react-doctor/rn-animate-layout-property";

describe("rule registry", () => {
  it("keeps the narrowed Reanimated layout-property rule enabled for React Native", () => {
    expect(ruleRegistry[REANIMATED_LAYOUT_RULE_ID]?.lifecycle).toBeUndefined();
    expect(ruleRegistry[REANIMATED_LAYOUT_RULE_ID]?.defaultEnabled).toBeUndefined();
    expect(ALL_REACT_DOCTOR_RULE_KEYS.has(REANIMATED_LAYOUT_RULE_KEY)).toBe(true);
    expect(REACT_NATIVE_RULES[REANIMATED_LAYOUT_RULE_KEY]).toBe("warn");
  });
});
