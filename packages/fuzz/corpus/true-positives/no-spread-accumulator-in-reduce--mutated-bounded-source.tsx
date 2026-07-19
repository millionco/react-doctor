// rule: no-spread-accumulator-in-reduce
// source: PR #1344 deep audit
export const appendItems = (items: string[]) => {
  const values: string[] = ["seed"];
  values.push(...items);
  return values.reduce((accumulator, item) => [...accumulator, item], [] as string[]);
};
