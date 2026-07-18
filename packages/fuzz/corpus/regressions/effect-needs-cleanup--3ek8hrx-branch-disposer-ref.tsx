// rule: effect-needs-cleanup
// weakness: cleanup-provenance
// source: react-bench pedropalau/react-bnb-gallery 3eK8hRx false positive
import { useCallback, useEffect, useRef } from "react";

export const usePointerDrag = () => {
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);
  const beginDrag = useCallback((pointer: boolean) => {
    const handleMove = () => undefined;
    if (pointer) {
      window.addEventListener("pointermove", handleMove);
      cleanupRef.current = () => window.removeEventListener("pointermove", handleMove);
    } else {
      window.addEventListener("mousemove", handleMove);
      cleanupRef.current = () => window.removeEventListener("mousemove", handleMove);
    }
  }, []);
  return { beginDrag };
};
