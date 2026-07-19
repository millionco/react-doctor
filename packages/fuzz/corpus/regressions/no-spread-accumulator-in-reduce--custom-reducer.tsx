// rule: no-spread-accumulator-in-reduce
// weakness: provenance
// source: PR #1344 deep audit
const custom = {
  reduce<Value>(callback: (accumulator: Value, item: string) => Value, seed: Value) {
    void callback;
    return seed;
  },
};

export const unchanged = custom.reduce(
  (accumulator, item) => [...accumulator, item],
  [] as string[],
);
