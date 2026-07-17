// rule: no-spread-accumulator-in-reduce
// source: PR #1344 Bugbot review
export const duplicateItems = (items: string[]) =>
  items.reduce((accumulator) => [...accumulator, ...accumulator], [] as string[]);
