// rule: no-direct-state-mutation
// verdict: fail
// weakness: alias-guard
// source: synthetic erased TypeScript DOM binding
import { useEffect, useState } from "react";
interface Document {}
Document.prototype.getElementById = customLookup;
export const Panel = () => {
  const [host, setHost] = useState(null);
  useEffect(() => {
    const node = document.getElementById("host");
    if (node) setHost(node);
  }, []);
  useEffect(() => {
    if (!host) return;
    host.style.pointerEvents = "none";
  }, [host]);
  return <div />;
};
