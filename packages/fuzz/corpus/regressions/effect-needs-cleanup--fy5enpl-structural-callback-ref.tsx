// rule: effect-needs-cleanup
// weakness: cleanup-provenance
// source: react-bench pedropalau/react-bnb-gallery fy5ENpL false positive
import { useCallback, useRef } from "react";

export const usePhotoZoom = () => {
  const cleanupRef = useRef<(() => void) | null>(null);
  const setViewportNode = useCallback((node: HTMLButtonElement | null) => {
    cleanupRef.current?.();
    if (!node) return;
    const handleWheel = () => undefined;
    node.addEventListener("wheel", handleWheel);
    cleanupRef.current = () => node.removeEventListener("wheel", handleWheel);
  }, []);
  return { setViewportNode };
};
