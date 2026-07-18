// rule: no-arithmetic-on-optional-chained-operand
// weakness: stale-binding-provenance
// source: adversarial audit of guard/optional-access rules
export const format = (item?: { price: number }): string => {
  if (!item) return "";
  item = undefined;
  return (item?.price * 2).toFixed(2);
};
