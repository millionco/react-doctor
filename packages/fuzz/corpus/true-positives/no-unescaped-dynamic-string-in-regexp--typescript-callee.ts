// rule: no-unescaped-dynamic-string-in-regexp
// weakness: wrapper-transparency
// source: adversarial audit of PR parsing/string-safety group

export const compileSearch = (searchTerm: string): RegExp =>
  new (RegExp as RegExpConstructor)(searchTerm, "i");
