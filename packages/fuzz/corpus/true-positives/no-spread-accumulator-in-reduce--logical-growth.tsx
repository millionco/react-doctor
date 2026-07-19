export const appendTruthy = <Value,>(values: Value[]) =>
  values.reduce<Value[]>((accumulator, value) => accumulator && [...accumulator, value], []);

export const appendFallback = <Value,>(values: Value[]) =>
  values.reduce<Value[]>((accumulator, value) => [...accumulator, value] || accumulator, []);

declare const externalEntries: Record<string, string>;

const dynamicEntries: Record<string, string> = {};
Object.assign(dynamicEntries, externalEntries);

export const entryNames = Object.keys(dynamicEntries).reduce<string[]>(
  (accumulator, key) => [...accumulator, key],
  [],
);
