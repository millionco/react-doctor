// rule: effect-raf-loop-needs-cancel
// weakness: scope-shadowing
// source: PR #1365 deep audit
import { useEffect } from "react";

export const Preview = () => {
  useEffect(() => {
    function frame() {
      const schedule = (frame: FrameRequestCallback) => requestAnimationFrame(frame);
      schedule(() => {});
    }

    requestAnimationFrame(frame);
  }, []);

  return null;
};
