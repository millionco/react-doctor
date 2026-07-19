// rule: effect-raf-loop-needs-cancel
// weakness: shadowed-progress-binding
// source: Cursor Bugbot review of PR #1365
import { useEffect } from "react";

export const Animation = () => {
  useEffect(() => {
    let frame = 0;
    const step = () => {
      frame++;
      {
        let frame = 0;
        frame = Math.random();
        consume(frame);
      }
      if (frame < 10) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, []);
  return null;
};
