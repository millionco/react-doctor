// rule: effect-needs-cleanup
// verdict: pass
// weakness: control-flow
// source: synthetic local allocator ownership
import { useEffect } from "react";

interface ResizeListenerProps {
  onResize: () => void;
}

export const ResizeBridge = ({ onResize }: ResizeListenerProps) => {
  useEffect(() => {
    const subscribeToResize = () => {
      const handleResize = () => onResize();
      window.addEventListener("resize", handleResize, false);
      return () => {
        window.removeEventListener("resize", handleResize, false);
      };
    };
    return subscribeToResize();
  }, [onResize]);
  return null;
};
