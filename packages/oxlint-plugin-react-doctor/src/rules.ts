import { reactDoctorRules } from "./plugin/rule-registry.js";
import { EXTERNAL_RULES, REACT_COMPILER_RULES } from "./external-rules.js";
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

// Scan and project rules stay in the full registry exports for
// metadata consumers (`REACT_DOCTOR_RULES`, `ALL_REACT_DOCTOR_RULE_KEYS`)
// but are excluded from the preset rule maps: their lint visitor is a
// no-op because they execute in @react-doctor/core, so enabling them in an
// ESLint/oxlint config would only register dead rules.
const isLintRule = (entry: RegistryEntry): boolean =>
  entry.rule.scan === undefined && entry.rule.execution !== "project";

const collectReactDoctorRulesByFramework = (frameworkName: RuleFramework) =>
  reactDoctorRules.filter(
    (entry) =>
      entry.rule.framework === frameworkName && isRecommendedByDefault(entry) && isLintRule(entry),
  );

const collectFrameworkSpecificRuleKeys = (): ReadonlySet<string> => {
  const collected = new Set<string>();
  for (const entry of reactDoctorRules) {
    if (entry.rule.framework !== "global") collected.add(entry.key);
  }
  return collected;
};

export const REACT_DOCTOR_RULES = reactDoctorRules;
export const REACT_DOCTOR_PROJECT_RULES = reactDoctorRules.filter(
  (entry) => entry.rule.execution === "project",
);
export const REACT_DOCTOR_OPT_IN_PROJECT_RULE_IDS: ReadonlySet<string> = new Set(
  REACT_DOCTOR_PROJECT_RULES.filter((entry) => entry.rule.defaultEnabled === false).map(
    (entry) => entry.id,
  ),
);

export { EXTERNAL_RULES, REACT_COMPILER_RULES };

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
  toKeyedSeverity(REACT_DOCTOR_RULES.filter(isLintRule)),
);
export const ALL_REACT_DOCTOR_RULE_KEYS: ReadonlySet<string> = new Set(
  REACT_DOCTOR_RULES.map((rule) => rule.key),
);
export const FRAMEWORK_SPECIFIC_RULE_KEYS = collectFrameworkSpecificRuleKeys();
