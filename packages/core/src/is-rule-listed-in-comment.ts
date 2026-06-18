import { isSameRuleKey } from "./rule-key-aliases.js";
import { tokenizeRuleList } from "./tokenize-rule-list.js";

export const isRuleListedInComment = (ruleList: string | undefined, ruleId: string): boolean => {
  const tokens = tokenizeRuleList(ruleList);
  // An absent / description-only rule list disables every rule.
  if (tokens.length === 0) return true;
  return tokens.some((token) => isSameRuleKey(token, ruleId));
};
