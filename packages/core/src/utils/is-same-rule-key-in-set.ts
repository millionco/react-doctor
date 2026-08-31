import { isSameRuleKey } from "../rule-key-aliases.js";

export const isSameRuleKeyInSet = (
  candidates: Iterable<string>,
  ruleIdentifier: string,
): boolean => {
  for (const candidate of candidates) {
    if (isSameRuleKey(candidate, ruleIdentifier)) return true;
  }
  return false;
};
