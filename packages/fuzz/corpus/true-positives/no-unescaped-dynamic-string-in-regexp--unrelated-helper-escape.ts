// rule: no-unescaped-dynamic-string-in-regexp
// weakness: sanitization-flow
// source: adversarial audit of PR parsing/string-safety group

declare const escapeRegExp: (value: string) => string;

const buildPattern = (value: string): string => {
  escapeRegExp("unused");
  return value;
};

export const compileSearch = (searchTerm: string): RegExp =>
  new RegExp(buildPattern(searchTerm), "i");
