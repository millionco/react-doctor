// rule: no-spread-accumulator-in-reduce
export const collectKeys = () => {
  const fixedValues = { first: true, second: true };
  return Object!
    ["keys"](fixedValues)
    .reduce((accumulator, key) => [...accumulator, key], [] as string[]);
};
