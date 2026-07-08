// rule: js-hoist-regexp, js-cache-property-access, js-length-check-first, js-tosorted-immutable
// weakness: control-flow
// source: FP-FIX history (loop-variant construction; mutation inside loop; fresh receivers)
export const testFlags = (flagVariants: string[], input: string) => {
  for (const flags of flagVariants) {
    const matcher = new RegExp("token", flags);
    matcher.test(input);
  }
};

export const bump = (state: { counter: { value: number } }, results: number[], n: number) => {
  for (let index = 0; index < n; index += 1) {
    state.counter.value = state.counter.value + 1;
    results.push(state.counter.value);
  }
};

export const arraysEqual = (a: number[], b: number[]) => {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
};

export const uniqueSorted = (ids: string[]) => [...new Set(ids)].sort();
export const sortedValues = (map: Map<string, number>) => [...map.values()].sort();
