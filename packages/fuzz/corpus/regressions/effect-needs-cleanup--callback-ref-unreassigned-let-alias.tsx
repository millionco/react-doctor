// rule: effect-needs-cleanup
// weakness: callback-ref-unreassigned-let-alias
// source: Cursor Bugbot review on React Doctor PR 1347

import { useCallback, useRef } from "react";

export const Viewport = ({ onWheel }: { onWheel: (event: WheelEvent) => void }) => {
  const viewportNodeRef = useRef<HTMLButtonElement | null>(null);
  const viewportRef = useCallback(
    (node: HTMLButtonElement | null) => {
      let previous = viewportNodeRef.current;
      if (previous) previous.removeEventListener("wheel", onWheel);
      viewportNodeRef.current = node;
      if (node) node.addEventListener("wheel", onWheel, { passive: false });
    },
    [onWheel],
  );
  return <button ref={viewportRef} />;
};
