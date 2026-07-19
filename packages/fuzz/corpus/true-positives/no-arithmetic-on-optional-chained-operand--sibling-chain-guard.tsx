// rule: no-arithmetic-on-optional-chained-operand
// weakness: alias-guard
// source: react-bench corpus audit 2026-07; a sibling total guard does not prove online exists
export const ratio = (health?: { online?: number; total?: number }): number => {
  const online = health?.online;
  const total = health?.total;
  return total ? online / total : 0;
};
