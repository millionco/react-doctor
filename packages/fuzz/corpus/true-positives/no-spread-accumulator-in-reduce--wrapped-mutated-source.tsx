export const appendAssertedItems = (items: string[]) => {
  const values: string[] = ["seed"];
  (values as string[]).push(...items);
  return (values as string[]).reduce((accumulator, item) => [...accumulator, item], [] as string[]);
};

export const appendNonNullItems = (items: string[]) => {
  const values: string[] = ["seed"];
  values!.push(...items);
  return values!.reduce((accumulator, item) => [...accumulator, item], [] as string[]);
};
