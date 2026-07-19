// rule: no-arithmetic-on-optional-chained-operand
// weakness: alias-guard
// source: adversarial audit of guard/optional-access rules
export const read = (item?: Item): string => {
  const ratio = item?.price / 2;
  Number.isNaN(ratio);
  if (item) return "missing";
  return ratio.toFixed(2);
};
export const nested = (item?: Item): number => item?.details?.price * 2;
