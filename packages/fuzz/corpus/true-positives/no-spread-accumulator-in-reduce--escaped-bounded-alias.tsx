// rule: no-spread-accumulator-in-reduce
// weakness: alias-resolution
// source: PR #1344 deep audit
declare const appendExternal: (items: string[]) => void;

export const appendItems = () => {
  const items: string[] = [];
  appendExternal(items);
  return items.reduce<string[]>((result, item) => [...result, item], []);
};
