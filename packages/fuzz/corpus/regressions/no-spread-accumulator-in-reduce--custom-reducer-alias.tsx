// rule: no-spread-accumulator-in-reduce
// weakness: alias-resolution
// source: PR #1344 Bugbot review
const customReducer = {
  reduce<T>(callback: (value: T[], item: T) => T[], seed: T[]) {
    return callback(seed, seed[0]!);
  },
};

const reducerAlias = customReducer;

export const appendWithCustomReducer = <T,>(items: T[]) =>
  reducerAlias.reduce((accumulator, item) => [...accumulator, item], items);
