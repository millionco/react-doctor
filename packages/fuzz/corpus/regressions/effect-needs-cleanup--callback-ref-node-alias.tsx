import { useCallback, useRef } from "react";

export const Viewport = ({ onWheel }) => {
  const viewportNodeRef = useRef<HTMLElement | null>(null);
  const viewportRef = useCallback(
    (node: HTMLElement | null) => {
      const currentNode = node;
      const previous = viewportNodeRef.current;
      if (previous) previous.removeEventListener("wheel", onWheel);
      viewportNodeRef.current = currentNode;
      if (currentNode) currentNode.addEventListener("wheel", onWheel, { passive: false });
    },
    [onWheel],
  );
  return <button ref={viewportRef} />;
};
