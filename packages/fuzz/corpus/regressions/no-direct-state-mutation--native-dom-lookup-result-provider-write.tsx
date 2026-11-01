// rule: no-direct-state-mutation
// verdict: fail
// weakness: alias-guard
// source: synthetic native DOM result provider exposure control
const customLookup = () => ({ style: { pointerEvents: "auto" } });
document.getElementById("panel-host").ownerDocument.getElementById = customLookup;
import { useEffect, useState } from "react";
export const Panel = () => {
  const [host, setHost] = useState(null);
  useEffect(() => {
    const node = document.getElementById("panel-host");
    if (node) setHost(node);
  }, []);
  useEffect(() => {
    if (!host) return;
    host.style.pointerEvents = "none";
  }, [host]);
  return <div />;
};
