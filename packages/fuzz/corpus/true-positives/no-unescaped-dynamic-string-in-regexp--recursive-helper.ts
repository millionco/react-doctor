// rule: no-unescaped-dynamic-string-in-regexp
// weakness: crash-recursion
// source: adversarial audit of PR parsing/string-safety group

const sanitize = (value: string): string => sanitize(value);

export const compileSearch = (searchTerm: string): RegExp => new RegExp(sanitize(searchTerm), "i");
