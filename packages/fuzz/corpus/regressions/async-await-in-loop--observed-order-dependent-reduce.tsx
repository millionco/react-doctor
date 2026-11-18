// rule: async-await-in-loop
// weakness: observed-sequential-reducer
// source: synthetic audit regression
export const collect = async (
  input: number[],
  read: (digit: number) => Promise<number>,
  factor: number,
) => {
  try {
    return await [1, 2, 3].reduce<number | Promise<number>>(async (previous, digit) => {
      const total = await previous;
      return total * 4 + digit;
    }, 0);
  } catch {
    return 0;
  }
};
