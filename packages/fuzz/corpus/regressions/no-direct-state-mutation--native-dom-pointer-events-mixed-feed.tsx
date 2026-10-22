// rule: no-direct-state-mutation
// verdict: fail
// weakness: alias-guard
// source: synthetic native DOM handle ownership control
import { useEffect, useState } from "react";
export const Panel = () => {
  const [host, setHost] = useState(null);
  useEffect(() => {
    const node = document.getElementById("panel-host");
    if (node) setHost(node);
    setHost({ style: { pointerEvents: "none" } });
  }, []);
  useEffect(() => {
    if (!host) return;
    host.style.pointerEvents = "none";
  }, [host]);
  return <div />;
};
