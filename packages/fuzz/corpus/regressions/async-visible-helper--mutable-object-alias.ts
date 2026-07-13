let cursor = 0;

const query = async (item: number) => {
  await Promise.resolve();
  return item * 2;
};

const helpers = { query };
let holder: typeof helpers;
holder = helpers;
const nestedHolder = holder;

nestedHolder.query = async (item: number) => {
  cursor += item;
  return cursor;
};

export const load = async () => {
  await query(1);
  await helpers.query(2);
  await query(3);
};
