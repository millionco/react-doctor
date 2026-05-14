import reactDoctorPlugin from "../../../plugin/react-doctor-plugin.js";
import type { RuleFramework } from "../../../plugin/utils/rule.js";
import type { RuleSeverity } from "./types.js";

// Derives a `{ "react-doctor/<rule-id>": <severity> }` map from the rule
// registry by filtering on each rule's colocated `framework` field. Every
// react-doctor rule ships `framework` + `severity` next to its `create`
// function in `defineRule({...})`; rule-maps.ts no longer owns these.
const collectRulesByFramework = (frameworkName: RuleFramework): Record<string, RuleSeverity> => {
  const collected: Record<string, RuleSeverity> = {};
  for (const [ruleId, rule] of Object.entries(reactDoctorPlugin.rules)) {
    if (rule.framework === frameworkName && rule.severity) {
      collected[`react-doctor/${ruleId}`] = rule.severity;
    }
  }
  return collected;
};

export const GLOBAL_REACT_DOCTOR_RULES = collectRulesByFramework("global");
export const NEXTJS_RULES = collectRulesByFramework("nextjs");
export const REACT_NATIVE_RULES = collectRulesByFramework("react-native");
export const TANSTACK_START_RULES = collectRulesByFramework("tanstack-start");
export const TANSTACK_QUERY_RULES = collectRulesByFramework("tanstack-query");

// HACK: every diagnostic from `eslint-plugin-react-hooks` (the React
// Compiler frontend, oxlint-namespaced as `react-hooks-js`) ships at
// `"error"` severity. Each one represents a code shape the compiler
// cannot optimize - leaving the surrounding component un-memoized at
// runtime - so we want the GitHub Action's default `--fail-on error`
// to trip on these. PR #140 silently downgraded the whole map to
// `"warn"` as part of a broader refactor, which made "React Compiler
// can't optimize this code" diagnostics stop counting toward
// `errorCount` and stop failing CI; restored here.
export const REACT_COMPILER_RULES: Record<string, RuleSeverity> = {
  "react-hooks-js/set-state-in-render": "error",
  "react-hooks-js/immutability": "error",
  "react-hooks-js/refs": "error",
  "react-hooks-js/purity": "error",
  "react-hooks-js/hooks": "error",
  "react-hooks-js/set-state-in-effect": "error",
  "react-hooks-js/globals": "error",
  "react-hooks-js/error-boundaries": "error",
  "react-hooks-js/preserve-manual-memoization": "error",
  "react-hooks-js/unsupported-syntax": "error",
  "react-hooks-js/component-hook-factories": "error",
  "react-hooks-js/static-components": "error",
  "react-hooks-js/use-memo": "error",
  "react-hooks-js/void-use-memo": "error",
  "react-hooks-js/incompatible-library": "error",
  "react-hooks-js/todo": "error",
};

// HACK: complementary rule surface from
// `eslint-plugin-react-you-might-not-need-an-effect` (#187). These
// fire alongside react-doctor's native `state-and-effects` rules when
// the plugin is installed, providing additional anti-pattern
// detection for effects. Severities are `warn` to match the rest of
// the effects-rule cohort and avoid changing CI pass/fail behavior
// for projects that adopt the plugin.
export const YOU_MIGHT_NOT_NEED_EFFECT_RULES: Record<string, RuleSeverity> = {
  "effect/no-derived-state": "warn",
  "effect/no-chain-state-updates": "warn",
  "effect/no-event-handler": "warn",
  "effect/no-adjust-state-on-prop-change": "warn",
  "effect/no-reset-all-state-on-prop-change": "warn",
  "effect/no-pass-live-state-to-parent": "warn",
  "effect/no-pass-data-to-parent": "warn",
  "effect/no-initialize-state": "warn",
};

export const BUILTIN_REACT_RULES: Record<string, RuleSeverity> = {
  "react/rules-of-hooks": "error",
  "react/no-direct-mutation-state": "error",
  "react/jsx-no-duplicate-props": "error",
  "react/jsx-key": "error",
  "react/no-children-prop": "warn",
  "react/no-danger": "warn",
  "react/jsx-no-script-url": "error",
  "react/no-render-return-value": "warn",
  "react/no-string-refs": "warn",
  "react/no-is-mounted": "warn",
  "react/require-render-return": "error",
  "react/no-unknown-property": "warn",
};

export const BUILTIN_A11Y_RULES: Record<string, RuleSeverity> = {
  "jsx-a11y/alt-text": "error",
  "jsx-a11y/anchor-is-valid": "warn",
  "jsx-a11y/click-events-have-key-events": "warn",
  "jsx-a11y/no-static-element-interactions": "warn",
  "jsx-a11y/role-has-required-aria-props": "error",
  "jsx-a11y/no-autofocus": "warn",
  "jsx-a11y/heading-has-content": "warn",
  "jsx-a11y/html-has-lang": "warn",
  "jsx-a11y/no-redundant-roles": "warn",
  "jsx-a11y/scope": "warn",
  "jsx-a11y/tabindex-no-positive": "warn",
  "jsx-a11y/label-has-associated-control": "warn",
  "jsx-a11y/no-distracting-elements": "error",
  "jsx-a11y/iframe-has-title": "warn",
};

// HACK: includes every rule that COULD be enabled by createOxlintConfig
// regardless of framework / TanStack flags. Used only by
// validateRuleRegistration to assert RULE_CATEGORY_MAP / RULE_HELP_MAP
// metadata coverage; we want to catch metadata gaps for all conditional
// rules, not just the ones active in the current scan's framework.
export const ALL_REACT_DOCTOR_RULE_KEYS: ReadonlySet<string> = new Set([
  ...Object.keys(GLOBAL_REACT_DOCTOR_RULES),
  ...Object.keys(NEXTJS_RULES),
  ...Object.keys(REACT_NATIVE_RULES),
  ...Object.keys(TANSTACK_START_RULES),
  ...Object.keys(TANSTACK_QUERY_RULES),
]);

export const FRAMEWORK_SPECIFIC_RULE_KEYS: ReadonlySet<string> = new Set([
  ...Object.keys(NEXTJS_RULES),
  ...Object.keys(REACT_NATIVE_RULES),
  ...Object.keys(TANSTACK_START_RULES),
  ...Object.keys(TANSTACK_QUERY_RULES),
]);
