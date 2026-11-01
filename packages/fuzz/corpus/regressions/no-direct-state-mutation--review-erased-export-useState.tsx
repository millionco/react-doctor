// rule: no-direct-state-mutation
// weakness: name-heuristic
// source: independent synthetic PR review regression
import { useState, useEffect } from "react";
import { useMergedRefs } from "@sample/ref-kit/internal";
export const Panel = ({ forwarded, modal }) => {
  const [node, setNode] = useState(null);
  const merged = useMergedRefs(forwarded, setNode);
  const Host = modal ? "dialog" : "div";
  useEffect(() => {
    if (node) node.style.visibility = "hidden";
  }, [node]);
  return <Host ref={merged} />;
};

export type { useState };
