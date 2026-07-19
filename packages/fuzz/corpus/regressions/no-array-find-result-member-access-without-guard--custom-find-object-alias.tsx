// rule: no-array-find-result-member-access-without-guard
// weakness: library-idiom
// source: adversarial audit of guard/optional-access rules
const query = { find: (_callback: () => boolean) => ({ value: 1 }) };
const alias = query;
export const value = alias.find(() => true).value;
