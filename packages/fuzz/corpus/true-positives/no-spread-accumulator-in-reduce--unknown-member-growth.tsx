// rule: no-spread-accumulator-in-reduce
// weakness: data-flow
// source: PR #1344 Bugbot review
export const mergeItems = (externalItems: string[]) => {
  const items: string[] = [];
  api.merge(items, externalItems);
  return items.reduce((accumulator, item) => [...accumulator, item], [] as string[]);
};

declare const api: {
  merge(items: string[], externalItems: string[]): void;
};
