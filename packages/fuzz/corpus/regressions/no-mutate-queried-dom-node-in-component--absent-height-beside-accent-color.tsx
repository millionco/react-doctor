// rule: no-mutate-queried-dom-node-in-component
// verdict: pass
// weakness: alias-guard
// source: synthetic absent inline declaration beside dynamic accentColor
interface PanelProps {
  accentColor: string;
}

export const Panel = ({ accentColor }: PanelProps) => {
  const node = document.getElementById("panel");
  node.style.height = "40px";
  return <div id="panel" style={{ accentColor }} />;
};
