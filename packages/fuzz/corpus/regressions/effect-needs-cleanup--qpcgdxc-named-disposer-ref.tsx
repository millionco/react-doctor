// rule: effect-needs-cleanup
// weakness: cleanup-provenance
// source: react-bench pedropalau/react-bnb-gallery qpcGDXC false positive
import { useCallback, useEffect, useRef } from "react";

export const useNamedMouseCleanup = () => {
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);
  const handleMouseDown = useCallback(() => {
    const handleMove = () => undefined;
    function cleanup() {
      window.removeEventListener("mousemove", handleMove);
    }
    cleanupRef.current = cleanup;
    window.addEventListener("mousemove", handleMove);
  }, []);
  return { handleMouseDown };
};
