// rule: no-non-literal-selector-query-without-try-catch
// weakness: validation
// source: adversarial audit of PR parsing/string-safety group

export const findHashTarget = (): Element | null => {
  const hash = location.hash;
  if (!hash.startsWith("#")) return null;
  return document.querySelector(hash);
};
