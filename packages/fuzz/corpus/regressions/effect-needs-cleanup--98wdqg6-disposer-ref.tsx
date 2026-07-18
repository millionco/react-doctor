// rule: effect-needs-cleanup
// weakness: cleanup-provenance
// source: react-bench pedropalau/react-bnb-gallery 98wDqG6 false positive
import { useCallback, useEffect, useRef } from "react";

export const useMouseDrag = () => {
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);
  const handleMouseDown = useCallback(() => {
    cleanupRef.current?.();
    const handleMove = () => undefined;
    cleanupRef.current = () => window.removeEventListener("mousemove", handleMove);
    window.addEventListener("mousemove", handleMove);
  }, []);
  return { handleMouseDown };
};
