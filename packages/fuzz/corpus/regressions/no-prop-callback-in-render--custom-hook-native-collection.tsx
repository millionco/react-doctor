// rule: no-prop-callback-in-render
// weakness: receiver-provenance
// source: React Bench fix-react-cloudscape-design-components-4461
export const useItemTotal = (items: readonly string[]) => {
  let total = 0;
  items.forEach((item) => {
    total += item.length;
  });
  return total;
};
