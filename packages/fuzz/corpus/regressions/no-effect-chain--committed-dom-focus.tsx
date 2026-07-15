// rule: no-effect-chain
// weakness: library-idiom
// source: Semiotic AccessibleNavTree benchmark trial

import { useEffect, useRef, useState } from "react";

export const AccessibleNavTree = ({ activeId }) => {
  const [expanded, setExpanded] = useState(new Set());
  const itemRefs = useRef(new Map());

  useEffect(() => {
    setExpanded(new Set([activeId]));
  }, [activeId]);

  useEffect(() => {
    itemRefs.current.get(activeId)?.focus();
  }, [activeId, expanded]);

  return expanded.has(activeId) ? (
    <button ref={(node) => itemRefs.current.set(activeId, node)}>Active</button>
  ) : null;
};
