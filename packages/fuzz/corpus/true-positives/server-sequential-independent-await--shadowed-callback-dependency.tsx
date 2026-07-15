// rule: server-sequential-independent-await
// weakness: name-heuristic
// source: ISSUES_TO_FIX_ASAP.md 2026-07-12 shadowed callback parameters

declare const loadFirst: () => Promise<number>;
declare const loadSecond: (selector: (first: number) => number) => Promise<number>;

export const loadAll = async (): Promise<number[]> => {
  const first = await loadFirst();
  const second = await loadSecond((first) => first + 1);
  return [first, second];
};
