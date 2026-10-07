// verdict: fail
// rule: effect-needs-cleanup
// weakness: cleanup-provenance
// source: issue #1594 adversarial boundary

import { useEffect } from "react";

export const ConnectionStatus = ({ source }) => {
  useEffect(() => {
    const timerRef = { current: null as ReturnType<typeof setTimeout> | null };
    const clearOfflineTimer = () => clearTimeout(timerRef.current);
    const applyState = (online: boolean) => {
      if (!online) timerRef.current = setTimeout(() => updateStatus(), 1_000);
    };

    source.read().then((online) => applyState(online));
    return () => clearOfflineTimer();
  }, [source]);

  return null;
};
