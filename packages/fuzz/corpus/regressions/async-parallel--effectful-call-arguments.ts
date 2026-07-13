// rule: async-parallel
// weakness: control-flow
// source: PR #1211 cross-review

const cell = { value: 1 };
const observedValues: number[] = [];

const getCell = () => {
  observedValues.push(cell.value);
  return cell;
};

const doubleCell = async (target: { value: number }) => {
  await Promise.resolve();
  target.value *= 2;
};

export const update = async () => {
  await doubleCell(getCell());
  await doubleCell(getCell());
  await doubleCell(getCell());
};
