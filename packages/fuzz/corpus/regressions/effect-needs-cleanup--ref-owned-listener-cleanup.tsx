// rule: effect-needs-cleanup
// weakness: cleanup-provenance
// source: Trycomp write-react-trycompai-comp-3248 retained resize callback
import { useCallback, useEffect, useRef } from "react";

export const useResizeSession = () => {
  const activeSessionRef = useRef<{
    handleMouseMove: EventListener;
    handleMouseUp: EventListener;
  } | null>(null);
  const stopResize = useCallback(() => {
    const session = activeSessionRef.current;
    if (session) {
      document.removeEventListener("mousemove", session.handleMouseMove);
      document.removeEventListener("mouseup", session.handleMouseUp);
      activeSessionRef.current = null;
    }
  }, []);
  useEffect(() => stopResize, [stopResize]);
  return useCallback(() => {
    stopResize();
    const handleMouseMove: EventListener = () => undefined;
    const handleMouseUp: EventListener = () => stopResize();
    activeSessionRef.current = { handleMouseMove, handleMouseUp };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [stopResize]);
};
