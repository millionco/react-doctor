import reactDoctorPlugin from "./plugin/react-doctor-plugin.js";
import type { RuleFramework } from "./plugin/utils/rule.js";
import type { OxlintRuleSeverity } from "./types.js";

const formatFullKey = (ruleId: string): string => `react-doctor/${ruleId}`;

const collectRulesByFramework = (
  frameworkName: RuleFramework,
): Record<string, OxlintRuleSeverity> => {
  const collected: Record<string, OxlintRuleSeverity> = {};
  for (const [ruleId, rule] of Object.entries(reactDoctorPlugin.rules)) {
    if (rule.framework === frameworkName && rule.severity) {
      collected[formatFullKey(ruleId)] = rule.severity;
    }
  }
  return collected;
};

const collectFrameworkSpecificRuleKeys = (): ReadonlySet<string> => {
  const collected = new Set<string>();
  for (const [ruleId, rule] of Object.entries(reactDoctorPlugin.rules)) {
    if (rule.framework !== "global") collected.add(formatFullKey(ruleId));
  }
  return collected;
};

export const RECOMMENDED_RULES = collectRulesByFramework("global");
export const NEXTJS_RULES = collectRulesByFramework("nextjs");
export const REACT_NATIVE_RULES = collectRulesByFramework("react-native");
export const TANSTACK_START_RULES = collectRulesByFramework("tanstack-start");
export const TANSTACK_QUERY_RULES = collectRulesByFramework("tanstack-query");
export const ALL_REACT_DOCTOR_RULES: Record<string, OxlintRuleSeverity> = {
  ...RECOMMENDED_RULES,
  ...NEXTJS_RULES,
  ...REACT_NATIVE_RULES,
  ...TANSTACK_START_RULES,
  ...TANSTACK_QUERY_RULES,
};
export const ALL_REACT_DOCTOR_RULE_KEYS: ReadonlySet<string> = new Set(
  Object.keys(reactDoctorPlugin.rules).map(formatFullKey),
);
export const FRAMEWORK_SPECIFIC_RULE_KEYS = collectFrameworkSpecificRuleKeys();

// HACK: every diagnostic from `eslint-plugin-react-hooks` ships at `"error"`
// severity. These represent React Compiler bailout shapes, so CI should fail.
export const REACT_COMPILER_RULES: Record<string, OxlintRuleSeverity> = {
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

// HACK: complementary optional rule surface from
// `eslint-plugin-react-you-might-not-need-an-effect` (#187).
export const YOU_MIGHT_NOT_NEED_EFFECT_RULES: Record<string, OxlintRuleSeverity> = {
  "effect/no-derived-state": "warn",
  "effect/no-chain-state-updates": "warn",
  "effect/no-event-handler": "warn",
  "effect/no-adjust-state-on-prop-change": "warn",
  "effect/no-reset-all-state-on-prop-change": "warn",
  "effect/no-pass-live-state-to-parent": "warn",
  "effect/no-pass-data-to-parent": "warn",
  "effect/no-initialize-state": "warn",
};

export const BUILTIN_REACT_RULES: Record<string, OxlintRuleSeverity> = {
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

export const BUILTIN_A11Y_RULES: Record<string, OxlintRuleSeverity> = {
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
