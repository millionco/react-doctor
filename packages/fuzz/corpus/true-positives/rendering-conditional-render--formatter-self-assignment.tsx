// rule: rendering-conditional-render
// verdict: fail
// weakness: alias-guard
// source: independently synthetic function self-binding replacement
function formatQuantity(value: number) {
  formatQuantity = () => 0;
  return `${value} pieces`;
}
export const QuantityBadge = ({ value }: { value: number }) => {
  formatQuantity(value);
  const itemCount = formatQuantity(value);
  return <section>{itemCount && <output>{itemCount}</output>}</section>;
};
