// rule: rendering-conditional-render
// verdict: fail
// weakness: name-heuristic
// source: independently synthetic numeric return alternative
const labelQuantity = (value: number) => {
  if (value === 0) return 0;
  return `${value} pieces`;
};
export const QuantityBadge = ({ value }: { value: number }) => {
  const itemCount = labelQuantity(value);
  return <section>{itemCount && <output>{itemCount}</output>}</section>;
};
