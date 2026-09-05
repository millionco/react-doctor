// rule: effect-needs-cleanup
// weakness: cleanup-provenance
// source: issue #1756
// verdict: pass
import { useEffect } from "react";

export const ChainedTimer = () => {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const clearTimer = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const schedule = (callback: () => void) => {
      timer = setTimeout(callback, 1000);
    };
    const advance = () => {
      timer = null;
      schedule(advance);
    };
    schedule(advance);
    return () => clearTimer();
  }, []);
  return null;
};
