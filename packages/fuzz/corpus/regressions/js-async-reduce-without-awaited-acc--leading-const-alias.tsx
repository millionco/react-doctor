// rule: js-async-reduce-without-awaited-acc
// weakness: direct-const-accumulator-alias
// source: synthetic audit regression
export const collect = (
  items: string[],
  read: (item: string) => Promise<number>,
  enabled: boolean,
) =>
  items["reduce"](async (previous, item) => {
    const pending = previous;
    const values = await pending;
    values.push(await read(item));
    return values;
  }, Promise.resolve<number[]>([]));
