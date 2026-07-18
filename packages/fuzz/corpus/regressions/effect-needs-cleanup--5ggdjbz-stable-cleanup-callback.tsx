// rule: effect-needs-cleanup
// weakness: cleanup-provenance
// source: react-bench pedropalau/react-bnb-gallery 5ggdJBZ false positive
import { useCallback, useEffect, useRef } from "react";

export const useWindowPan = () => {
  const cleanupRef = useRef<(() => void) | null>(null);
  const detachWindowListeners = useCallback(() => cleanupRef.current?.(), []);
  const attachWindowListeners = useCallback(() => {
    const handleMove = () => undefined;
    window.addEventListener("mousemove", handleMove);
    cleanupRef.current = () => window.removeEventListener("mousemove", handleMove);
  }, []);
  useEffect(() => detachWindowListeners, [detachWindowListeners]);
  return { attachWindowListeners };
};
