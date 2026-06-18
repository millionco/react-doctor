// HACK: ESLint convention — text after ` -- ` on a disable comment is a
// human-readable description, not part of the rule list. Strip it before
// tokenizing so trailing prose like `-- read in render via useDebounce;
// user can type before commit` doesn't pollute rule matching (#159).
const stripDescriptionTail = (ruleList: string): string => {
  const descriptionMatch = ruleList.match(/(?:^|\s)--\s/);
  if (!descriptionMatch || descriptionMatch.index === undefined) return ruleList;
  return ruleList.slice(0, descriptionMatch.index);
};

// Splits the rule-id section of a `*-disable*` comment into individual
// rule-key tokens, dropping the optional ` -- description` tail. Returns
// an empty array for an absent / whitespace-only / description-only list
// (which callers treat as "applies to every rule").
export const tokenizeRuleList = (ruleList: string | undefined): string[] => {
  const trimmed = ruleList?.trim();
  if (!trimmed) return [];
  const ruleSection = stripDescriptionTail(trimmed).trim();
  if (!ruleSection) return [];
  return ruleSection
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter(Boolean);
};
