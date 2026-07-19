// rule: no-spread-accumulator-in-reduce
// weakness: ownership
const sharedRows: string[] = [];

export const appendRows = (rows: string[]) =>
  rows.reduce((accumulator, row) => [...accumulator, row], sharedRows);
