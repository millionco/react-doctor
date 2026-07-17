// rule: no-mutate-queried-dom-node-in-component
// weakness: alias-guard
// source: PR #1000 deep adversarial audit

export const Panel = ({ color, items }: { color: string; items: Element[] }) => {
  const node = document.getElementById("panel");
  items.map((node) => node.id);
  if (node) node.style.color = "red";
  return <div id="panel" style={{ color }} />;
};
