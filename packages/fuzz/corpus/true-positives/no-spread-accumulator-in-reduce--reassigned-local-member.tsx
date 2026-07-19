// rule: no-spread-accumulator-in-reduce
// weakness: data-flow
// source: PR #1344 exact-head audit
export const mergeItems = (externalItems: string[]) => {
  const items: string[] = [];
  const api: { merge: (items: string[], externalItems: string[]) => void } = { merge() {} };
  api.merge = externalMerge;
  api.merge(items, externalItems);
  return items.reduce((accumulator, item) => [...accumulator, item], [] as string[]);
};

declare const externalMerge: (items: string[], externalItems: string[]) => void;
