// rule: no-spread-accumulator-in-reduce
export const collectDynamicKeys = (externalValues: Record<string, boolean>) => {
  const values = { seed: true };
  (Object as ObjectConstructor).assign(values, externalValues);
  return Object.keys(values).reduce((accumulator, key) => [...accumulator, key], [] as string[]);
};
