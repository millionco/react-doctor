// HACK: ESLint convention — text after ` -- ` on a disable comment is a
// human-readable description, not part of the rule list. Strip it
// before tokenizing so trailing prose like `-- read in render via
// useDebounce; user can type before commit` doesn't pollute the
// rule-equality check or get matched against `ruleId`.
const stripDescriptionTail = (ruleList: string): string => {
  const descriptionMatch = ruleList.match(/(?:^|\s)--\s/);
  if (!descriptionMatch || descriptionMatch.index === undefined) return ruleList;
  return ruleList.slice(0, descriptionMatch.index);
};

export const isRuleListedInComment = (ruleList: string | undefined, ruleId: string): boolean => {
  const trimmed = ruleList?.trim();
  if (!trimmed) return true;
  const ruleSection = stripDescriptionTail(trimmed).trim();
  if (!ruleSection) return true;
  return ruleSection.split(/[,\s]+/).some((token) => token.trim() === ruleId);
};
