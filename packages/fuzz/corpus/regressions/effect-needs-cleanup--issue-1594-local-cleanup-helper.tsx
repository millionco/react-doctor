// verdict: pass
// rule: effect-needs-cleanup
// weakness: cleanup-provenance
// source: issue #1594

import { useEffect } from "react";

export const ConnectionStatus = ({ online }) => {
  useEffect(() => {
    const timerRef = { current: null as ReturnType<typeof setTimeout> | null };
    const clearOfflineTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    const applyState = (nextOnline: boolean) => {
      if (!nextOnline && !timerRef.current) {
        timerRef.current = setTimeout(() => updateStatus(), 1_000);
      }
    };

    applyState(online);
    return () => {
      clearOfflineTimer();
    };
  }, [online]);

  return null;
};
