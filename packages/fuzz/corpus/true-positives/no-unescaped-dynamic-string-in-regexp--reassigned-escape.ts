// rule: no-unescaped-dynamic-string-in-regexp
// weakness: control-flow
// source: adversarial audit of PR parsing/string-safety group

export const buildMatcher = (searchTerm: string): RegExp => {
  let escapedSearchTerm = RegExp.escape(searchTerm);
  escapedSearchTerm = searchTerm;
  return new RegExp(escapedSearchTerm, "i");
};
