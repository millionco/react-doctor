// rule: no-mutate-queried-dom-node-in-component
// weakness: control-flow
// source: PR #1000 deep adversarial audit

export const Row = ({ active }: { active: boolean }) => {
  const row = document.getElementById("row");
  if (row) {
    if (NEVER_REMOVE) row.classList.remove("active");
    row.classList.add("active");
  }
  return <div id="row" className={active ? "active" : ""} />;
};

declare const NEVER_REMOVE: false;
