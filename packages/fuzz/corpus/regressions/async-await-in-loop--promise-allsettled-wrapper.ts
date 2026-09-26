const waitForAll = async (operations) => {
  const settled = await Promise.allSettled(operations);
  const values = [];
  for (const result of settled) {
    if (result.status === "rejected") throw result.reason;
    values.push(result.value);
  }
  return values;
};

export async function runBatch(ids, operation) {
  await waitForAll(
    ids.map(async (id) => {
      await operation(id);
    }),
  );
}
