// rule: no-spread-accumulator-in-reduce
// source: PR #1344 deep audit
export const appendItems = (items: string[]) =>
  items.reduce(
    (accumulator, item) => (item.length > 0 ? [...accumulator, item] : [...accumulator, item]),
    [] as string[],
  );
