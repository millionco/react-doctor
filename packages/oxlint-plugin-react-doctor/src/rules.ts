import { reactDoctorRules } from "./plugin/rule-registry.js";
import type { RuleFramework } from "./plugin/utils/rule.js";
import type { OxlintRuleSeverity } from "./types.js";

type RegistryEntry = (typeof reactDoctorRules)[number];

interface KeyedSeverity {
  readonly key: string;
  readonly severity: OxlintRuleSeverity;
}

const toRuleMap = (entries: ReadonlyArray<KeyedSeverity>): Record<string, OxlintRuleSeverity> =>
  Object.fromEntries(entries.map((entry) => [entry.key, entry.severity]));

const toKeyedSeverity = (entries: ReadonlyArray<RegistryEntry>): ReadonlyArray<KeyedSeverity> =>
  entries.map((entry) => ({ key: entry.key, severity: entry.rule.severity }));

// Skips rules with `defaultEnabled: false` — these ship in the plugin
// for opt-in but are not part of any recommended preset. The oxlint
// config builder in `@react-doctor/core` honors this flag via the
// `severityControls` override path; presets exported from this package
// (used by the ESLint `recommended` flat config) must respect it too,
// or ESLint users would silently get every default-disabled rule.
const isRecommendedByDefault = (entry: RegistryEntry): boolean =>
  entry.rule.defaultEnabled !== false;

// Scan rules (`scan` field) stay in the full registry exports for
// metadata consumers (`REACT_DOCTOR_RULES`, `ALL_REACT_DOCTOR_RULE_KEYS`)
// but are excluded from the preset rule maps: their lint visitor is a
// no-op (they run via @react-doctor/core's check-security-scan
// environment check), so enabling them in an ESLint/oxlint config would
// only register dead rules.
const isScanRule = (entry: RegistryEntry): boolean => entry.rule.scan !== undefined;

const collectReactDoctorRulesByFramework = (frameworkName: RuleFramework) =>
  reactDoctorRules.filter(
    (entry) =>
      entry.rule.framework === frameworkName && isRecommendedByDefault(entry) && !isScanRule(entry),
  );

const collectExternalRulesBySource = (source: string) =>
  EXTERNAL_RULES.filter((rule) => rule.source === source);

const collectFrameworkSpecificRuleKeys = (): ReadonlySet<string> => {
  const collected = new Set<string>();
  for (const entry of reactDoctorRules) {
    if (entry.rule.framework !== "global") collected.add(entry.key);
  }
  return collected;
};

export const REACT_DOCTOR_RULES = reactDoctorRules;

// Only React Compiler rules remain external. The previous
// `react/*`, `jsx-a11y/*`, and `effect/*` entries are now natively
// ported into this package and ship through `REACT_DOCTOR_RULES`.
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
  // These stay `error`: each react-hooks-js compiler diagnostic marks code the
  // React Compiler could NOT optimize (an unmemoizable component shape), which
  // is a real perf regression — not redundant-memo cleanup. Demoting them hid
  // those regressions (regression #140). The redundant-memo cleanup lives in
  // the local `react-compiler-no-manual-memoization` rule instead.
  { key: "react-hooks-js/use-memo", source: "react-compiler", severity: "error" },
  { key: "react-hooks-js/void-use-memo", source: "react-compiler", severity: "error" },
  { key: "react-hooks-js/incompatible-library", source: "react-compiler", severity: "error" },
  { key: "react-hooks-js/todo", source: "react-compiler", severity: "error" },
] as const;

export const RULES = [...REACT_DOCTOR_RULES, ...EXTERNAL_RULES] as const;

export const RECOMMENDED_RULES = toRuleMap(
  toKeyedSeverity(collectReactDoctorRulesByFramework("global")),
);
export const NEXTJS_RULES = toRuleMap(
  toKeyedSeverity(collectReactDoctorRulesByFramework("nextjs")),
);
export const REACT_NATIVE_RULES = toRuleMap(
  toKeyedSeverity(collectReactDoctorRulesByFramework("react-native")),
);
export const TANSTACK_START_RULES = toRuleMap(
  toKeyedSeverity(collectReactDoctorRulesByFramework("tanstack-start")),
);
export const TANSTACK_QUERY_RULES = toRuleMap(
  toKeyedSeverity(collectReactDoctorRulesByFramework("tanstack-query")),
);
export const PREACT_RULES = toRuleMap(
  toKeyedSeverity(collectReactDoctorRulesByFramework("preact")),
);
export const ALL_REACT_DOCTOR_RULES = toRuleMap(
  toKeyedSeverity(REACT_DOCTOR_RULES.filter((entry) => !isScanRule(entry))),
);
export const ALL_REACT_DOCTOR_RULE_KEYS: ReadonlySet<string> = new Set(
  REACT_DOCTOR_RULES.map((rule) => rule.key),
);
export const FRAMEWORK_SPECIFIC_RULE_KEYS = collectFrameworkSpecificRuleKeys();
export const REACT_COMPILER_RULES = toRuleMap(collectExternalRulesBySource("react-compiler"));
