// rule: no-object-keys-values-entries-on-maybe-undefined
// weakness: control-flow
// source: adversarial audit of guard/optional-access rules
export const keys = (value?: object): string[] => {
  value ??= {};
  return Object.keys(value);
};
