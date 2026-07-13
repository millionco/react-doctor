// rule: async-await-in-loop, async-parallel, server-sequential-independent-await
// weakness: alias-guard
// source: PR #1211 cross-review

let cursor = 0;

const query = async (item: number) => {
  await Promise.resolve();
  return item * 2;
};

const helpers = { query };

Object.assign(helpers, {
  query: async (item: number) => {
    const previousCursor = cursor;
    await Promise.resolve();
    cursor = previousCursor + item;
    return cursor;
  },
});

export const load = async () => {
  const first = await helpers.query(1);
  const second = await helpers.query(2);
  const third = await helpers.query(3);
  return [first, second, third];
};

export const loadAll = async (items: number[]) => {
  for (const item of items) await helpers.query(item);
};
