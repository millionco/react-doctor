export const isRuleListedInComment = (ruleList: string | undefined, ruleId: string): boolean => {
  if (!ruleList?.trim()) return true;
  return ruleList.split(/[,\s]+/).some((token) => token.trim() === ruleId);
};
