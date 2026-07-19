// rule: no-spread-accumulator-in-reduce
// weakness: control-flow
// source: PR #1344 Bugbot review
export const appendItems = (externalItems: string[], ...items: string[]) => {
  const alias = items;
  alias.push(...externalItems);
  return items.reduce<string[]>((result, item) => [...result, item], []);
};
