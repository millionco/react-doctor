// rule: no-spread-accumulator-in-reduce
// weakness: alias-guard
// source: PR #1344 Bugbot review
export const listKeys = (usePrimary: boolean) => {
  const primary = { first: 1 };
  const alias = primary;
  const selected = usePrimary ? alias : { second: 2 };
  return Object.keys(selected).reduce<string[]>((keys, key) => [...keys, key], []);
};
