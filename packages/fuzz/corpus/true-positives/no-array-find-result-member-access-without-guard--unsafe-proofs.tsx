// rule: no-array-find-result-member-access-without-guard
// weakness: guard-polarity
// source: adversarial audit of guard/optional-access rules
export const read = (items: Item[], predicate: (item: Item) => boolean): string => {
  if (items.findIndex(predicate)) return items.find(predicate).name;
  return items.find(() => Math.random() > 0.5).name;
};
