// rule: no-effect-chain
// weakness: alias-guard
// source: PR #1325 adversarial review

import { useEffect, useRef, useState } from "react";

export const ReassignedRefCallbackMap = ({ activeId, controller }) => {
  const [expanded, setExpanded] = useState(new Set());
  const [status, setStatus] = useState("idle");
  const itemRefs = useRef(null);
  itemRefs.current ??= new Map();
  const localController = { focus: () => setStatus("ready") };

  useEffect(() => {
    setExpanded(new Set([activeId]));
  }, [activeId]);

  useEffect(() => {
    itemRefs.current?.get(activeId)?.focus();
  }, [activeId, expanded]);

  return (
    <button
      ref={(node) => {
        node = controller ?? localController;
        itemRefs.current?.set(activeId, node);
      }}
    >
      {status}
    </button>
  );
};
