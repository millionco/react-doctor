import { getEquivalentRuleKeys } from "@react-doctor/core";
import type { ReactDoctorConfig, RuleSeverityOverride } from "@react-doctor/core";

/**
 * Sets a per-rule severity, replacing any existing entry for the same
 * rule (including legacy-aliased keys, so a config still targeting
 * `react/no-danger` is rewritten to the canonical key instead of
 * leaving a dead duplicate).
 */
export const setRuleSeverity = (
  config: ReactDoctorConfig,
  ruleKey: string,
  severity: RuleSeverityOverride,
): ReactDoctorConfig => {
  const equivalentKeys = new Set(getEquivalentRuleKeys(ruleKey));
  const nextRules: Record<string, RuleSeverityOverride> = {};
  for (const [existingKey, existingSeverity] of Object.entries(config.rules ?? {})) {
    if (!equivalentKeys.has(existingKey)) nextRules[existingKey] = existingSeverity;
  }
  nextRules[ruleKey] = severity;
  return { ...config, rules: nextRules };
};

export const setCategorySeverity = (
  config: ReactDoctorConfig,
  category: string,
  severity: RuleSeverityOverride,
): ReactDoctorConfig => ({
  ...config,
  categories: { ...config.categories, [category]: severity },
});

export const addIgnoredTag = (config: ReactDoctorConfig, tag: string): ReactDoctorConfig => {
  const currentTags = config.ignore?.tags ?? [];
  if (currentTags.includes(tag)) return config;
  return {
    ...config,
    ignore: { ...config.ignore, tags: [...new Set([...currentTags, tag])].sort() },
  };
};

export const removeIgnoredTag = (config: ReactDoctorConfig, tag: string): ReactDoctorConfig => {
  const currentTags = config.ignore?.tags ?? [];
  if (!currentTags.includes(tag)) return config;
  const remainingTags = currentTags.filter((existingTag) => existingTag !== tag);
  const { tags: _removed, ...remainingIgnore } = config.ignore ?? {};
  // Drop the `ignore` block entirely when removing the tag empties it,
  // so toggling a tag off doesn't leave `{ "ignore": {} }` behind.
  if (remainingTags.length === 0) {
    if (Object.keys(remainingIgnore).length === 0) {
      const { ignore: _ignore, ...configWithoutIgnore } = config;
      return configWithoutIgnore;
    }
    return { ...config, ignore: remainingIgnore };
  }
  return { ...config, ignore: { ...remainingIgnore, tags: remainingTags } };
};
