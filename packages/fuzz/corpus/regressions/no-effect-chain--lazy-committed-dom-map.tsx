// rule: no-effect-chain
// weakness: library-idiom
// source: React Bench Semiotic AccessibleNavTree trial 5pBVfxL

import { useEffect, useRef, useState } from "react";

export const AccessibleNavTree = ({ activeId }: { activeId: string }) => {
  const [expanded, setExpanded] = useState(new Set<string>());
  const itemRefs = useRef<Map<string, HTMLButtonElement | null> | null>(null);
  itemRefs.current ??= new Map();

  useEffect(() => {
    setExpanded(new Set([activeId]));
  }, [activeId]);

  useEffect(() => {
    itemRefs.current?.get(activeId)?.focus();
  }, [activeId, expanded]);

  return expanded.has(activeId) ? (
    <button
      ref={(node) => {
        if (node) itemRefs.current?.set(activeId, node);
        else itemRefs.current?.delete(activeId);
      }}
    >
      Active
    </button>
  ) : null;
};
