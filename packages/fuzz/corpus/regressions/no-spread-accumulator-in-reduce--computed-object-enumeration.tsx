// rule: no-spread-accumulator-in-reduce
// weakness: dynamic-computed
// source: PR #1344 Bugbot review
const glyphs = { first: "a", second: "b" };

export const glyphNames = Object["keys"](glyphs).reduce(
  (names, name) => [...names, name],
  [] as string[],
);
