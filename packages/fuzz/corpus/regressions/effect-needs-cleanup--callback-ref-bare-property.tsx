import { useCallback, useRef } from "react";

export const useViewport = ({ onWheel }) => {
  const viewportNodeRef = useRef<HTMLElement | null>(null);
  const attachViewportListeners = useCallback(
    (node: HTMLElement | null) => {
      const previous = viewportNodeRef.current;
      if (previous) previous.removeEventListener("wheel", onWheel);
      viewportNodeRef.current = node;
      if (node) node.addEventListener("wheel", onWheel, { passive: false });
    },
    [onWheel],
  );
  return { ref: attachViewportListeners };
};
