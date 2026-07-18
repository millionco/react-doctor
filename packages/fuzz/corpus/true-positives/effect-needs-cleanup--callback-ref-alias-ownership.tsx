// rule: effect-needs-cleanup
// weakness: identity-provenance
// source: PR #1347 Bugbot review — assigning the node to a value alias does not retain ownership
import { useCallback, useRef } from "react";

export const Viewport = ({ onWheel }: { onWheel: EventListener }) => {
  const viewportNodeRef = useRef<HTMLButtonElement | null>(null);
  const viewportRef = useCallback(
    (node: HTMLButtonElement | null) => {
      let previous = viewportNodeRef.current;
      if (previous) previous.removeEventListener("wheel", onWheel);
      previous = node;
      if (node) node.addEventListener("wheel", onWheel);
    },
    [onWheel],
  );
  return <button ref={viewportRef} />;
};
