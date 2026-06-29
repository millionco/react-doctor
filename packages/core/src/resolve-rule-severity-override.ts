import type { RuleSeverityControls, RuleSeverityOverride } from "./types/index.js";
import { isSameRuleKey } from "./rule-key-aliases.js";

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
  if (controls.rules) {
    for (const [configuredRuleKey, configuredRuleOverride] of Object.entries(controls.rules)) {
      if (isSameRuleKey(configuredRuleKey, input.ruleKey)) return configuredRuleOverride;
    }
  }
  return input.category !== undefined ? controls.categories?.[input.category] : undefined;
};
