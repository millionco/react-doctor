// rule: no-mutate-queried-dom-node-in-component
// weakness: control-flow
// source: PR #1000 deep adversarial audit

export const Row = ({ opacity, restore }: { opacity: string; restore: boolean }) => {
  const row = document.getElementById("row");
  if (row) {
    const previousOpacity = row.style.opacity;
    row.style.opacity = "0";
    if (restore) row.style.opacity = previousOpacity;
  }
  return <div id="row" style={{ opacity }} />;
};
