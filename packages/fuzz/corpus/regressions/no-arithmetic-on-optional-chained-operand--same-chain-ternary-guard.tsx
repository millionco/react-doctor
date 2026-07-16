// rule: no-arithmetic-on-optional-chained-operand
// weakness: alias-guard
// source: react-bench corpus audit 2026-07 (system health widget: ternary tests a sibling alias from the same optional chain, so the division never sees undefined)
export const SystemHealthWidget = ({
  health,
}: {
  health?: { processes?: { online?: number; total?: number } };
}) => {
  const procOnline = health?.processes?.online;
  const procTotal = health?.processes?.total;
  const ratio = procTotal ? Math.max(0.25, procOnline / procTotal) : 0.25;
  return <meter aria-label="Process health" value={ratio} />;
};
