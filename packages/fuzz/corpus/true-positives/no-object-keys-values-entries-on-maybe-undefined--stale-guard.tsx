// rule: no-object-keys-values-entries-on-maybe-undefined
// weakness: stale-binding-provenance
// source: adversarial audit of guard/optional-access rules
export const keys = (value?: object): string[] => {
  if (!value) return [];
  value = undefined;
  return Object.keys(value);
};
