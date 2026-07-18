// rule: effect-raf-loop-needs-cancel
// weakness: reschedule-alias
// source: Cursor Bugbot review of PR #1365
import { useEffect } from "react";

export const Animation = () => {
  useEffect(() => {
    const step = () => {
      const continueStep = step;
      requestAnimationFrame(continueStep);
    };
    requestAnimationFrame(step);
  }, []);
  return null;
};
