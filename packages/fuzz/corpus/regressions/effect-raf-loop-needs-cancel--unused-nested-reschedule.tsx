// rule: effect-raf-loop-needs-cancel
// weakness: callback-reachability
// source: Cursor Bugbot review of PR #1365
import { useEffect } from "react";

export const Animation = () => {
  useEffect(() => {
    const step = () => {
      const _debugLoop = () => requestAnimationFrame(step);
      paint();
    };
    requestAnimationFrame(step);
  }, []);
  return null;
};
