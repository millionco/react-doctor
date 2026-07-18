// rule: no-unescaped-dynamic-string-in-regexp
// weakness: scope
// source: adversarial audit of PR parsing/string-safety group

const normalize = (value: string): string => {
  const RegExp = { escape: (innerValue: string) => innerValue };
  return RegExp.escape(value);
};

export const buildMatcher = (searchTerm: string): RegExp => {
  const searchPattern = normalize(searchTerm);
  return new RegExp(searchPattern, "i");
};
