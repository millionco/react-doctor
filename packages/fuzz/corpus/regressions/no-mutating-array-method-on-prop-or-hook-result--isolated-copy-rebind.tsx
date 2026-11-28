// rule: no-mutating-array-method-on-prop-or-hook-result
// verdict: pass
// weakness: control-flow
// source: synthetic array copy rebound before sorting

export function List({ items }: { items: string[] }) {
  const next = [...items];
  items = next;
  return <div>{items.sort().join(",")}</div>;
}
