import { getEquivalentRuleKeys } from "@react-doctor/core";
import type { ReactDoctorConfig, RuleSeverityOverride } from "@react-doctor/core";
import type { RuleCatalogEntry } from "./rule-catalog.js";

export type EffectiveSeveritySource = "rule" | "category" | "tag" | "default";

export interface EffectiveRuleSeverity {
  /** Severity the rule effectively runs at, in config vocabulary. */
  readonly value: RuleSeverityOverride;
  /** Which config layer decided the value (most specific wins). */
  readonly source: EffectiveSeveritySource;
}

/**
 * Resolves what a rule will actually do under the current config without
 * running a scan. `ignore.tags` is a pre-lint gate: a rule carrying an
 * ignored tag is dropped (via `shouldEnableRule`) before any severity is
 * read, so it wins over a `rules`/`categories` override. Among rules that
 * survive the gate, `rules` beats `categories` beats the registry default.
 */
export const resolveEffectiveRuleSeverity = (
  config: ReactDoctorConfig | null,
  entry: RuleCatalogEntry,
): EffectiveRuleSeverity => {
  const ignoredTags = config?.ignore?.tags ?? [];
  if (entry.tags.some((tag) => ignoredTags.includes(tag))) {
    return { value: "off", source: "tag" };
  }

  const ruleOverrides = config?.rules ?? {};
  for (const equivalentKey of getEquivalentRuleKeys(entry.key)) {
    const override = ruleOverrides[equivalentKey];
    if (override !== undefined) return { value: override, source: "rule" };
  }

  const categoryOverride = config?.categories?.[entry.category];
  if (categoryOverride !== undefined) return { value: categoryOverride, source: "category" };

  return {
    value: entry.defaultEnabled ? entry.defaultSeverity : "off",
    source: "default",
  };
};
