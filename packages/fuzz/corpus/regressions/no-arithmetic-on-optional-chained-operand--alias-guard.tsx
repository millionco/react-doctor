// rule: no-arithmetic-on-optional-chained-operand
// weakness: alias-guard
// source: PR #1000 adversarial review (extract-then-guard idiom re-derefs the chain)
export const Price = ({ item }: { item?: { price?: number } }) => {
  const price = item?.price;
  if (!price) return null;
  const total = item?.price * 2;
  return <span>{total.toFixed(2)}</span>;
};
