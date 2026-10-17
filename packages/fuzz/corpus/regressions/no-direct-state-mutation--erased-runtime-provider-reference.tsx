// rule: no-direct-state-mutation
// weakness: alias-guard
// source: independently-authored-public-synthetic
// verdict: fail

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
import { mutate } from "./external";
function expose() {
  interface useState {}
  mutate(useState);
}
expose();
