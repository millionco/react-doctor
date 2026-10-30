// rule: no-mutate-queried-dom-node-in-component
// verdict: pass
// weakness: alias-guard
// source: synthetic absent inline declaration beside dynamic transform
interface PanelProps {
  transform: string;
}

export const Panel = ({ transform }: PanelProps) => {
  const node = document.getElementById("panel");
  node.style.height = "40px";
  return <div id="panel" style={{ transform }} />;
};
