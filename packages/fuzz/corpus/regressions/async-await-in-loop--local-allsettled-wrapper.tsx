// rule: async-await-in-loop
// weakness: wrapper-transparency
// source: https://github.com/millionco/react-doctor/issues/1839
// verdict: pass

const waitForAll = async <Result,>(operations: Promise<Result>[]): Promise<Result[]> => {
  const settled = await Promise.allSettled(operations);
  const values: Result[] = [];
  for (const result of settled) {
    if (result.status === "rejected") throw result.reason;
    values.push(result.value);
  }
  return values;
};

export const runBatch = async (items: string[], operation: (item: string) => Promise<void>) => {
  await waitForAll(
    items.map(async (item) => {
      await operation(item);
    }),
  );
};
