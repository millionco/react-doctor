// rule: server-sequential-independent-await
// verdict: fail
// weakness: alias-guard
// source: cached-async-work independent request control
const read = (key: string) => fetch(`/value/${key}`);

export const load = async (key: string) => {
  const first = await read(key);
  const second = await read(key);
  return [first, second];
};
