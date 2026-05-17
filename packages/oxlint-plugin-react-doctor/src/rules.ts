import { reactDoctorRules } from "./plugin/rule-registry.js";
import type { RuleFramework } from "./plugin/utils/rule.js";
import type { OxlintRuleSeverity } from "./types.js";

interface RuleMapEntry {
  key: string;
  severity: OxlintRuleSeverity;
}

const toRuleMap = (rules: ReadonlyArray<RuleMapEntry>): Record<string, OxlintRuleSeverity> =>
  Object.fromEntries(rules.map((rule) => [rule.key, rule.severity]));

const collectReactDoctorRulesByFramework = (frameworkName: RuleFramework) =>
  reactDoctorRules.filter((rule) => rule.framework === frameworkName);

const collectExternalRulesBySource = (source: string) =>
  EXTERNAL_RULES.filter((rule) => rule.source === source);

const collectFrameworkSpecificRuleKeys = (): ReadonlySet<string> => {
  const collected = new Set<string>();
  for (const rule of reactDoctorRules) {
    if (rule.framework !== "global") collected.add(rule.key);
  }
  return collected;
};

export const REACT_DOCTOR_RULES = reactDoctorRules;

export const EXTERNAL_RULES = [
  { key: "react-hooks-js/set-state-in-render", source: "react-compiler", severity: "error" },
  { key: "react-hooks-js/immutability", source: "react-compiler", severity: "error" },
  { key: "react-hooks-js/refs", source: "react-compiler", severity: "error" },
  { key: "react-hooks-js/purity", source: "react-compiler", severity: "error" },
  { key: "react-hooks-js/hooks", source: "react-compiler", severity: "error" },
  { key: "react-hooks-js/set-state-in-effect", source: "react-compiler", severity: "error" },
  { key: "react-hooks-js/globals", source: "react-compiler", severity: "error" },
  { key: "react-hooks-js/error-boundaries", source: "react-compiler", severity: "error" },
  {
    key: "react-hooks-js/preserve-manual-memoization",
    source: "react-compiler",
    severity: "error",
  },
  { key: "react-hooks-js/unsupported-syntax", source: "react-compiler", severity: "error" },
  {
    key: "react-hooks-js/component-hook-factories",
    source: "react-compiler",
    severity: "error",
  },
  { key: "react-hooks-js/static-components", source: "react-compiler", severity: "error" },
  { key: "react-hooks-js/use-memo", source: "react-compiler", severity: "error" },
  { key: "react-hooks-js/void-use-memo", source: "react-compiler", severity: "error" },
  { key: "react-hooks-js/incompatible-library", source: "react-compiler", severity: "error" },
  { key: "react-hooks-js/todo", source: "react-compiler", severity: "error" },
  { key: "effect/no-derived-state", source: "you-might-not-need-effect", severity: "warn" },
  { key: "effect/no-chain-state-updates", source: "you-might-not-need-effect", severity: "warn" },
  { key: "effect/no-event-handler", source: "you-might-not-need-effect", severity: "warn" },
  {
    key: "effect/no-adjust-state-on-prop-change",
    source: "you-might-not-need-effect",
    severity: "warn",
  },
  {
    key: "effect/no-reset-all-state-on-prop-change",
    source: "you-might-not-need-effect",
    severity: "warn",
  },
  {
    key: "effect/no-pass-live-state-to-parent",
    source: "you-might-not-need-effect",
    severity: "warn",
  },
  { key: "effect/no-pass-data-to-parent", source: "you-might-not-need-effect", severity: "warn" },
  { key: "effect/no-initialize-state", source: "you-might-not-need-effect", severity: "warn" },
  { key: "react/rules-of-hooks", source: "builtin-react", severity: "error" },
  { key: "react/no-direct-mutation-state", source: "builtin-react", severity: "error" },
  { key: "react/jsx-no-duplicate-props", source: "builtin-react", severity: "error" },
  { key: "react/jsx-key", source: "builtin-react", severity: "error" },
  { key: "react/no-children-prop", source: "builtin-react", severity: "warn" },
  { key: "react/no-danger", source: "builtin-react", severity: "warn" },
  { key: "react/jsx-no-script-url", source: "builtin-react", severity: "error" },
  { key: "react/no-render-return-value", source: "builtin-react", severity: "warn" },
  { key: "react/no-string-refs", source: "builtin-react", severity: "warn" },
  { key: "react/no-is-mounted", source: "builtin-react", severity: "warn" },
  { key: "react/require-render-return", source: "builtin-react", severity: "error" },
  { key: "react/no-unknown-property", source: "builtin-react", severity: "warn" },
  { key: "jsx-a11y/alt-text", source: "builtin-a11y", severity: "error" },
  { key: "jsx-a11y/anchor-is-valid", source: "builtin-a11y", severity: "warn" },
  { key: "jsx-a11y/click-events-have-key-events", source: "builtin-a11y", severity: "warn" },
  { key: "jsx-a11y/no-static-element-interactions", source: "builtin-a11y", severity: "warn" },
  { key: "jsx-a11y/role-has-required-aria-props", source: "builtin-a11y", severity: "error" },
  { key: "jsx-a11y/no-autofocus", source: "builtin-a11y", severity: "warn" },
  { key: "jsx-a11y/heading-has-content", source: "builtin-a11y", severity: "warn" },
  { key: "jsx-a11y/html-has-lang", source: "builtin-a11y", severity: "warn" },
  { key: "jsx-a11y/no-redundant-roles", source: "builtin-a11y", severity: "warn" },
  { key: "jsx-a11y/scope", source: "builtin-a11y", severity: "warn" },
  { key: "jsx-a11y/tabindex-no-positive", source: "builtin-a11y", severity: "warn" },
  { key: "jsx-a11y/label-has-associated-control", source: "builtin-a11y", severity: "warn" },
  { key: "jsx-a11y/no-distracting-elements", source: "builtin-a11y", severity: "error" },
  { key: "jsx-a11y/iframe-has-title", source: "builtin-a11y", severity: "warn" },
] as const;

export const RULES = [...REACT_DOCTOR_RULES, ...EXTERNAL_RULES] as const;

export const RECOMMENDED_RULES = toRuleMap(collectReactDoctorRulesByFramework("global"));
export const NEXTJS_RULES = toRuleMap(collectReactDoctorRulesByFramework("nextjs"));
export const REACT_NATIVE_RULES = toRuleMap(collectReactDoctorRulesByFramework("react-native"));
export const TANSTACK_START_RULES = toRuleMap(collectReactDoctorRulesByFramework("tanstack-start"));
export const TANSTACK_QUERY_RULES = toRuleMap(collectReactDoctorRulesByFramework("tanstack-query"));
export const ALL_REACT_DOCTOR_RULES = toRuleMap(REACT_DOCTOR_RULES);
export const ALL_REACT_DOCTOR_RULE_KEYS: ReadonlySet<string> = new Set(
  REACT_DOCTOR_RULES.map((rule) => rule.key),
);
export const FRAMEWORK_SPECIFIC_RULE_KEYS = collectFrameworkSpecificRuleKeys();
export const REACT_COMPILER_RULES = toRuleMap(collectExternalRulesBySource("react-compiler"));
export const YOU_MIGHT_NOT_NEED_EFFECT_RULES = toRuleMap(
  collectExternalRulesBySource("you-might-not-need-effect"),
);
export const BUILTIN_REACT_RULES = toRuleMap(collectExternalRulesBySource("builtin-react"));
export const BUILTIN_A11Y_RULES = toRuleMap(collectExternalRulesBySource("builtin-a11y"));
