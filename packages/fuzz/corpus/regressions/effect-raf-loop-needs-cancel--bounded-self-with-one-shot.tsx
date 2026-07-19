// rule: effect-raf-loop-needs-cancel
// weakness: reschedule-identity
// source: Cursor Bugbot review of PR #1365
import { useEffect } from "react";

export const Animation = () => {
  useEffect(() => {
    let frame = 0;
    const paintOnce = () => paint();
    const step = () => {
      frame++;
      requestAnimationFrame(paintOnce);
      if (frame < 10) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, []);
  return null;
};
