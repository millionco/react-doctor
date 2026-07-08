// rule: no-spread-accumulator-in-reduce
// weakness: control-flow
// source: PR #1000 corpus sweep (artsy: Array.from(Array(4)) is bounded by the literal)
export const prepareImageURLs = (imageURLs: (string | null)[]) =>
  Array.from(Array(4)).reduce<(string | null)[]>(
    (accumulator, _, index) => [...accumulator, imageURLs[index] ?? null],
    [],
  );
