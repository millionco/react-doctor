// rule: no-spread-accumulator-in-reduce
// weakness: bounded-growth
// source: PR #1344 deep audit
export const collectLabel = (items: Array<{ name: string }>) =>
  items.reduce<Record<string, string>>(
    (result, item) => ({ ...result, ...{ label: item.name } }),
    {},
  );
