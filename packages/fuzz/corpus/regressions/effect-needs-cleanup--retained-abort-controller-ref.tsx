// rule: effect-needs-cleanup
// weakness: data-flow
// source: react-bench pedropalau/react-bnb-gallery 5CLQhDy false positive
import { useCallback, useEffect, useRef } from "react";

export const DragHandle = () => {
  const dragAbortRef = useRef<AbortController | null>(null);

  const stopMouseDrag = useCallback(() => {
    dragAbortRef.current?.abort();
    dragAbortRef.current = null;
  }, []);

  const handleMouseDown = useCallback(() => {
    dragAbortRef.current?.abort();
    const controller = new AbortController();
    dragAbortRef.current = controller;
    const { signal } = controller;
    window.addEventListener("mousemove", updateDrag, { signal });
    window.addEventListener("mouseup", stopMouseDrag, { signal });
  }, [stopMouseDrag]);

  useEffect(
    () => () => {
      dragAbortRef.current?.abort();
    },
    [],
  );

  return (
    <button type="button" onMouseDown={handleMouseDown}>
      drag
    </button>
  );
};
