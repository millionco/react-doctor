// rule: effect-needs-cleanup
// weakness: cleanup-provenance
// source: react-bench pedropalau/react-bnb-gallery EtLZbea false positive
import { useCallback, useEffect, useRef } from "react";

export const useWheelTarget = () => {
  const cleanupRef = useRef<(() => void) | null>(null);
  const buttonRef = useCallback((node: HTMLButtonElement | null) => {
    cleanupRef.current?.();
    if (!node) return;
    const handleWheel = () => undefined;
    node.addEventListener("wheel", handleWheel);
    cleanupRef.current = () => node.removeEventListener("wheel", handleWheel);
  }, []);
  useEffect(() => () => cleanupRef.current?.(), []);
  return { buttonRef };
};
