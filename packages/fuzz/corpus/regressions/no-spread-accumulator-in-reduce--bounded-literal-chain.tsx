// rule: no-spread-accumulator-in-reduce
// weakness: control-flow
// source: PR #1344 Bugbot review
export const buildLabels = () =>
  ["first", "second"]
    .map((label) => label.toUpperCase())
    .reduce((labels, label) => [...labels, label], [] as string[]);
