// rule: effect-raf-loop-needs-cancel
// verdict: pass
// weakness: cross-scope-cleanup
import { useEffect } from "react";

export const Example = () => {
  useEffect(() => {
    let frameId = 0;
    const tick = () => {
      frameId = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (frameId !== 0) {
        cancelAnimationFrame(frameId);
        frameId = 0;
      }
    };
    frameId = requestAnimationFrame(tick);
    return () => {
      stop();
    };
  }, []);
  return null;
};
