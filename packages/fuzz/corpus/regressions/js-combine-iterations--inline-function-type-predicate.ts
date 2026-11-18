// rule: js-combine-iterations
// weakness: typescript-filter-type-predicate
// source: synthetic audit regression
type Row = { amount: number };
export const amounts = (items: readonly (Row | null)[]) =>
  items
    .filter(function isRow(item): item is Row {
      return item !== null && item.amount > 0;
    })
    .map((item) => item.amount);
