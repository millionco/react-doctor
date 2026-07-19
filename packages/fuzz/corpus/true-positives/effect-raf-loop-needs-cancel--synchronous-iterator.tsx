// rule: effect-raf-loop-needs-cancel
// weakness: callback-flow
// source: Cursor Bugbot review of PR #1365

import { useEffect } from "react";

export const Ticker = ({ canvas }: { canvas: HTMLCanvasElement }): null => {
  useEffect(() => {
    [canvas].forEach(() => {
      const loop = () => requestAnimationFrame(loop);
      requestAnimationFrame(loop);
    });
  }, [canvas]);
  return null;
};
