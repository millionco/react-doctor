// rule: no-mutating-array-method-on-prop-or-hook-result
// verdict: fail
// weakness: parameter-origin; source: synthetic
export const useRows = (options, items) => {
  items.sort();
  return items;
};

export const useEntries = (options, enabled, { entries }) => {
  entries.splice(0, 1);
  return entries;
};
