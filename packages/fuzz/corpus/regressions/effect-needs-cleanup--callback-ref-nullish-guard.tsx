// rule: effect-needs-cleanup
// weakness: control-flow
// source: PR #1347 Bugbot review — a non-null guard proves the previous node exists
import { useCallback, useRef } from "react";

export const Viewport = ({ onViewportEvent }: { onViewportEvent: EventListener }) => {
  const viewportNodeRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useCallback(
    (node: HTMLDivElement | null) => {
      const previous = viewportNodeRef.current;
      if (previous !== null) previous.removeEventListener("viewportchange", onViewportEvent);
      viewportNodeRef.current = node;
      if (node) node.addEventListener("viewportchange", onViewportEvent);
    },
    [onViewportEvent],
  );
  return <div ref={viewportRef} />;
};
