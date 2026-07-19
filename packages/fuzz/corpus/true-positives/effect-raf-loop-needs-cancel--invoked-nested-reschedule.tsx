// rule: effect-raf-loop-needs-cancel
// weakness: callback-reachability
// source: Cursor Bugbot review of PR #1365
import { useEffect } from "react";

export const Animation = () => {
  useEffect(() => {
    const step = () => {
      const continueLoop = () => requestAnimationFrame(step);
      paint();
      continueLoop();
    };
    requestAnimationFrame(step);
  }, []);
  return null;
};
