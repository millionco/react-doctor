// rule: rendering-conditional-render
// verdict: pass
// weakness: name-heuristic
// source: independently synthetic local string result
const labelQuantity = (value: number) => {
  if (value < 0) return undefined;
  return `${value} pieces`;
};
export const QuantityBadge = ({ value }: { value: number }) => {
  const itemCount = labelQuantity(value);
  return <section>{itemCount && <output>{itemCount}</output>}</section>;
};
