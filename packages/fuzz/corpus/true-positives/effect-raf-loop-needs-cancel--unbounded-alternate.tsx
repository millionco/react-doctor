// rule: effect-raf-loop-needs-cancel
// weakness: branch-polarity
// source: Cursor Bugbot review of PR #1365
import { useEffect } from "react";

export const Animation = () => {
  useEffect(() => {
    let frame = 0;
    const step = () => {
      frame++;
      if (frame < 10) finish();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, []);
  return null;
};
