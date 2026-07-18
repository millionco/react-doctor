// rule: effect-needs-cleanup
// weakness: control-flow
// source: PR #1347 Bugbot review — logical assignment does not transfer ownership on every call
import { useCallback, useRef } from "react";

export const Viewport = ({ onWheel }: { onWheel: EventListener }) => {
  const viewportNodeRef = useRef<HTMLButtonElement | null>(null);
  const viewportRef = useCallback(
    (node: HTMLButtonElement | null) => {
      const previous = viewportNodeRef.current;
      if (previous) previous.removeEventListener("wheel", onWheel);
      viewportNodeRef.current ||= node;
      if (node) node.addEventListener("wheel", onWheel);
    },
    [onWheel],
  );
  return <button ref={viewportRef} />;
};
