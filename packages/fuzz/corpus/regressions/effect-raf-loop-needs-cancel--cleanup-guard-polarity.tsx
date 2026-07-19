// rule: effect-raf-loop-needs-cancel
// weakness: control-flow-polarity
// source: Cursor Bugbot review of PR #1365

import { useEffect } from "react";

export const CleanupGuardPolarity = (): null => {
  useEffect(() => {
    let active = true;
    const frame = () => {
      if (!active) return;
      renderFrame();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    return () => {
      active = false;
    };
  }, []);
  return null;
};

declare const renderFrame: () => void;
