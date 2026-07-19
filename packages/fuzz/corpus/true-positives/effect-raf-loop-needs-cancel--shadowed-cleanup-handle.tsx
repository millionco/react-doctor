// rule: effect-raf-loop-needs-cancel
// weakness: alias-guard
// source: Cursor Bugbot review of PR #1365

import { useEffect } from "react";

export const Clock = (): null => {
  useEffect(() => {
    let requestId: number;
    const loop = () => {
      requestId = requestAnimationFrame(loop);
    };
    requestId = requestAnimationFrame(loop);
    void requestId;
    return () => {
      const requestId = unrelatedFrameId;
      cancelAnimationFrame(requestId);
    };
  }, []);
  return null;
};

declare const unrelatedFrameId: number;
