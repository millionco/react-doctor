import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../test-utils/run-rule.js";
import retiredRuleCases from "../test-utils/retired-rule-cases.json";
import {
  RECOMMENDED_RULES,
  NEXTJS_RULES,
  REACT_NATIVE_RULES,
  TANSTACK_START_RULES,
} from "../rules.js";
import plugin from "./react-doctor-plugin.js";
import { ruleRegistry } from "./rule-registry.js";

const OPTIONAL_RULE_IDS = [
  "agent-tool-capability-risk",
  "artifact-baas-authority-surface",
  "firebase-query-filter-as-auth",
  "js-cache-property-access",
  "js-combine-iterations",
  "js-flatmap-filter",
  "js-length-check-first",
  "jsx-max-depth",
  "mcp-tool-capability-risk",
  "nextjs-no-client-fetch-for-server-data",
  "nextjs-no-img-element",
  "no-barrel-import",
  "no-impure-call-at-module-scope",
  "no-usememo-simple-expression",
  "prefer-module-scope-pure-function",
  "prefer-module-scope-static-value",
  "prefer-useReducer",
  "rendering-hoist-jsx",
  "rendering-svg-precision",
  "rn-bottom-sheet-prefer-native",
  "rn-no-non-native-navigator",
  "rn-no-panresponder",
  "rn-prefer-expo-image",
  "rn-prefer-pressable",
  "server-dedup-props",
  "zod-v4-prefer-top-level-string-formats",
];

describe("retired rule compatibility", () => {
  it("excludes retired and optional checks from default framework presets", () => {
    const ruleIds = [...retiredRuleCases.map(({ ruleId }) => ruleId), ...OPTIONAL_RULE_IDS];
    const presets = [RECOMMENDED_RULES, NEXTJS_RULES, REACT_NATIVE_RULES, TANSTACK_START_RULES];
    for (const preset of presets) {
      for (const ruleId of ruleIds) {
        expect(preset).not.toHaveProperty(`react-doctor/${ruleId}`);
      }
    }
  });

  it.each(retiredRuleCases)("keeps $ruleId silent when explicitly invoked", ({ ruleId, code }) => {
    const rule = ruleRegistry[ruleId];
    expect(rule).toBeDefined();
    expect(rule.lifecycle).toBe("retired");
    expect(rule.defaultEnabled).toBe(false);
    const result = runRule(rule, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(runRule(plugin.rules[ruleId], code).diagnostics).toEqual([]);
  });

  it.each(OPTIONAL_RULE_IDS)("keeps %s available only by opt-in", (ruleId) => {
    const rule = ruleRegistry[ruleId];
    expect(rule).toBeDefined();
    expect(rule.lifecycle).toBeUndefined();
    expect(rule.defaultEnabled).toBe(false);
  });
});
