// rule: effect-raf-loop-needs-cancel
// weakness: reference-matching
// source: Cursor Bugbot review of PR #1365

import { useEffect } from "react";

export const Ticker = (): null => {
  useEffect(() => {
    const state = { running: true, teardown: () => {} };
    const loop = () => {
      if (!state.running) return;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return () => state.teardown();
  }, []);
  return null;
};
