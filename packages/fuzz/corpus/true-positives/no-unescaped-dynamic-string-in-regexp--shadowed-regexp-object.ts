// rule: no-unescaped-dynamic-string-in-regexp
// weakness: binding-resolution
// source: adversarial audit of PR parsing/string-safety group

export const compileSearch = (searchPattern: string): RegExp => new RegExp(searchPattern, "i");

export const readFlags = (): string => {
  const searchPattern = /fixed/;
  return searchPattern.flags;
};
