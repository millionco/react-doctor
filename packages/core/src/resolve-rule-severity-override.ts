import type { RuleSeverityControls, RuleSeverityOverride } from "./types/index.js";
import { getEquivalentRuleKeys } from "./rule-key-aliases.js";

interface RuleOverrideLookupInput {
  ruleKey: string;
  category?: string;
}

/**
 * Resolves the user-configured severity override for a rule.
 * Per-rule overrides win over per-category overrides. Returns
 * `undefined` when neither channel matches — callers should fall
 * back to the rule's built-in severity.
 */
export const resolveRuleSeverityOverride = (
  input: RuleOverrideLookupInput,
  controls: RuleSeverityControls | undefined,
): RuleSeverityOverride | undefined => {
  if (!controls) return undefined;
  const exactRuleOverride = controls.rules?.[input.ruleKey];
  if (exactRuleOverride !== undefined) return exactRuleOverride;
  for (const equivalentRuleKey of getEquivalentRuleKeys(input.ruleKey)) {
    if (equivalentRuleKey === input.ruleKey) continue;
    const equivalentRuleOverride = controls.rules?.[equivalentRuleKey];
    if (equivalentRuleOverride !== undefined) return equivalentRuleOverride;
  }
  return input.category !== undefined ? controls.categories?.[input.category] : undefined;
};
