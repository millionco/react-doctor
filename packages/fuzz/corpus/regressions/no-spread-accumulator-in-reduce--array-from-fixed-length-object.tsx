// rule: no-spread-accumulator-in-reduce
// weakness: false-positive
// source: PR #1344 Bugbot review
export const buildPlaceholders = () =>
  Array.from({ length: 4 }).reduce<(string | null)[]>(
    (accumulator, item) => [...accumulator, item],
    [],
  );
