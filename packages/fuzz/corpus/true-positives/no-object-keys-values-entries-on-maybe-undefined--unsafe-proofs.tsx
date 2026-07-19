// rule: no-object-keys-values-entries-on-maybe-undefined
// weakness: control-flow
// source: adversarial audit of guard/optional-access rules
export const keys = (params?: object): string[] => {
  if (!params) return Object.keys(params);
  return [];
};
export const load = (): Promise<string[]> =>
  fetch("/data")
    .then((response) => Object.keys(response?.body))
    .catch();
