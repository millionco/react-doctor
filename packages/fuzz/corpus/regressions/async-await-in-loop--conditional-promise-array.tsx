// rule: async-await-in-loop
// weakness: wrapper-insertion
// source: synthetic native parity regression
export const load = async (items, enabled) => {
  const jobs = enabled ? [] : items.map(async (item) => await fetch(item));
  await Promise.all(jobs);
};
