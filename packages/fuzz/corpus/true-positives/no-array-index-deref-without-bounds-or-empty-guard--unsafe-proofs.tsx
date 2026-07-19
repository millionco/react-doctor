// rule: no-array-index-deref-without-bounds-or-empty-guard
// weakness: guard-polarity
// source: adversarial audit of guard/optional-access rules
export const split = (value: string): string => {
  if (/./.test(value)) return value.split(".")[1].trim();
  return "";
};
export const capture = (value: string): string =>
  value.match(/a(b)?/) ? value.match(/a(b)?/)[1].trim() : "";
