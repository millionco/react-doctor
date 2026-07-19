// rule: no-unescaped-dynamic-string-in-regexp
// weakness: control-flow
// source: adversarial audit of PR parsing/string-safety group

export const compileSearch = (searchPattern: string): RegExp | null => {
  try {
    return new RegExp(searchPattern, "i");
  } catch {
    return null;
  }
};
