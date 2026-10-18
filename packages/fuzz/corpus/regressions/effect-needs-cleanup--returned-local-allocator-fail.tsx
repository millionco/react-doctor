// rule: effect-needs-cleanup
// verdict: fail
// weakness: control-flow
// source: synthetic discarded local allocator disposer
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
    subscribeToResize();
    return subscribeToResize();
  }, [onResize]);
  return null;
};
