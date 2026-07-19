// rule: no-unescaped-dynamic-string-in-regexp
// weakness: sanitization
// source: adversarial audit of PR parsing/string-safety group

export const compileSearch = (searchTerm: string): RegExp =>
  new RegExp(searchTerm.replaceAll(" ", "-"), "i");
