import reactDoctorPlugin from "../../../plugin/react-doctor-plugin.js";
import type { RuleFramework } from "../../../plugin/utils/rule.js";
import type { RuleSeverity } from "./types.js";

// All exports here are derived at module load from the colocated
// `defineRule({...})` metadata on each rule in
// `plugin/rules/<bucket>/<rule>.ts`. None of these values are written by
// hand — adding a new rule (with `framework` + `severity` in its
// definition) automatically extends the appropriate map and set.

const formatFullKey = (ruleId: string): string => `react-doctor/${ruleId}`;

// Derives a `{ "react-doctor/<rule-id>": <severity> }` map by filtering
// the rule registry on each rule's colocated `framework` field. Used by
// `createOxlintConfig` (oxlint scan) and `eslint-plugin.ts` (ESLint
// `recommended` / `next` / `react-native` / `tanstack-start` /
// `tanstack-query` flat configs).
const collectRulesByFramework = (frameworkName: RuleFramework): Record<string, RuleSeverity> => {
  const collected: Record<string, RuleSeverity> = {};
  for (const [ruleId, rule] of Object.entries(reactDoctorPlugin.rules)) {
    if (rule.framework === frameworkName && rule.severity) {
      collected[formatFullKey(ruleId)] = rule.severity;
    }
  }
  return collected;
};

export const GLOBAL_REACT_DOCTOR_RULES = collectRulesByFramework("global");
export const NEXTJS_RULES = collectRulesByFramework("nextjs");
export const REACT_NATIVE_RULES = collectRulesByFramework("react-native");
export const TANSTACK_START_RULES = collectRulesByFramework("tanstack-start");
export const TANSTACK_QUERY_RULES = collectRulesByFramework("tanstack-query");

// Every rule that COULD be enabled by createOxlintConfig regardless of
// framework / TanStack flags. Used by `validateRuleRegistration` to assert
// per-rule metadata coverage (we want to catch metadata gaps for all
// conditional rules, not just the ones active in the current scan).
export const ALL_REACT_DOCTOR_RULE_KEYS: ReadonlySet<string> = new Set(
  Object.keys(reactDoctorPlugin.rules).map(formatFullKey),
);

// Just the framework-gated rules (`framework !== "global"`) — these need
// an explicit `requires: [...]` capability gate or they won't activate on
// any project. Used by `validateRuleRegistration` to enforce that gate.
const collectFrameworkSpecificRuleKeys = (): ReadonlySet<string> => {
  const collected = new Set<string>();
  for (const [ruleId, rule] of Object.entries(reactDoctorPlugin.rules)) {
    if (rule.framework !== "global") collected.add(formatFullKey(ruleId));
  }
  return collected;
};
export const FRAMEWORK_SPECIFIC_RULE_KEYS = collectFrameworkSpecificRuleKeys();
