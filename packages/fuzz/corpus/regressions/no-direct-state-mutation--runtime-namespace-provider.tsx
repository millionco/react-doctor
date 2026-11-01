// rule: no-direct-state-mutation
// verdict: pass
// weakness: alias-guard
// source: synthetic namespace provider binding
namespace Document {
  export const prototype = { getElementById: customLookup };
}
Document.prototype.getElementById = customLookup;
import { useEffect, useState } from "react";
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
