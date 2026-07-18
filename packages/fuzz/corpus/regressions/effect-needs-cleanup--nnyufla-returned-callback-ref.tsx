// rule: effect-needs-cleanup
// weakness: cleanup-provenance
// source: react-bench pedropalau/react-bnb-gallery nnYUFLa false positive
import { useCallback, useRef } from "react";

export const useViewport = () => {
  const cleanupRef = useRef<(() => void) | null>(null);
  const setViewportRef = useCallback((node: HTMLButtonElement | null) => {
    cleanupRef.current?.();
    if (!node) return;
    const handleMove = () => undefined;
    node.addEventListener("pointermove", handleMove);
    cleanupRef.current = () => node.removeEventListener("pointermove", handleMove);
  }, []);
  return { setViewportRef };
};
