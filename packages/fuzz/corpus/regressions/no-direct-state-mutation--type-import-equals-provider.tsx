// rule: no-direct-state-mutation
// verdict: fail
// weakness: alias-guard
// source: synthetic provider binding namespace control
import type Document = require("./types");
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
