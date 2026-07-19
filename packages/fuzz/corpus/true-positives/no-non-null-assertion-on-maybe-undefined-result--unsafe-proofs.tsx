// rule: no-non-null-assertion-on-maybe-undefined-result
// weakness: control-flow
// source: adversarial audit of guard/optional-access rules
export const read = (flag: boolean, key: string): number => {
  const values = new Map<string, { value: number }>();
  if (flag) values.set(key, { value: 1 });
  return values.get(key)!.value;
};
export const find = (rows: Row[]): string =>
  rows.some((row) => row.ok) === false ? rows.find((row) => row.ok)!.name : "";
