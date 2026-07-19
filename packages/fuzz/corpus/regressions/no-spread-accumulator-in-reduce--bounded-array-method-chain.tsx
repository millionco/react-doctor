// rule: no-spread-accumulator-in-reduce
// weakness: control-flow
// source: PR #1344 Bugbot review
export const buildSlots = () =>
  Array(4)
    .fill(null)
    .map((_, index) => index)
    .reduce((slots, index) => [...slots, index], [] as number[]);
