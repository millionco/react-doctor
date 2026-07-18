// rule: effect-needs-cleanup
// weakness: callback-ref-listener-replacement
// source: react-bench write-react-pedropalau-react-bnb-gallery zsbYAgG

import { useCallback, useRef } from "react";

export const useViewport = (onWheel: (event: WheelEvent) => void) => {
  const viewportNodeRef = useRef<HTMLButtonElement | null>(null);
  const attachViewportListeners = useCallback(
    (node: HTMLButtonElement | null) => {
      const previous = viewportNodeRef.current;
      if (previous) {
        previous.removeEventListener("wheel", onWheel);
      }

      viewportNodeRef.current = node;
      if (node) {
        node.addEventListener("wheel", onWheel, { passive: false });
      }
    },
    [onWheel],
  );

  return { viewportRef: attachViewportListeners };
};
