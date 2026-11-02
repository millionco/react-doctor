// rule: no-mutate-queried-dom-node-in-component
// verdict: pass
// weakness: alias-guard
// source: synthetic mixed literal and dynamic style properties
import { useEffect } from "react";

interface PanelProps {
  tone: string;
}

export const Panel = ({ tone }: PanelProps) => {
  useEffect(() => {
    document.getElementById("panel").style.height = "40px";
  }, []);
  return <div id="panel" style={{ color: tone, height: 20 }} />;
};
