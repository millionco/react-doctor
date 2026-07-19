// rule: no-spread-accumulator-in-reduce
// source: PR #1344 Bugbot review
export const appendTrackedItems = (items: string[]) =>
  items.reduce((accumulator, item) => (void item, [...accumulator, item]), [] as string[]);

export const appendDynamicArray = (items: string[]) =>
  Array(4, ...items).reduce((accumulator, item) => [...accumulator, String(item)], [] as string[]);
