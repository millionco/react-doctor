// rule: no-spread-accumulator-in-reduce
// source: PR #1344 Bugbot review
export const appendItems = (items: string[]) =>
  Array(4)
    .concat(items)
    .reduce((accumulator, item) => [...accumulator, item], [] as string[]);
