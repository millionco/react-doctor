// rule: no-array-index-deref-without-bounds-or-empty-guard
// weakness: guard-polarity
// source: adversarial audit of guard/optional-access rules
export const second = (value: string): string =>
  value.match(/(a)/g) ? value.match(/(a)/g)[1].trim() : "";
