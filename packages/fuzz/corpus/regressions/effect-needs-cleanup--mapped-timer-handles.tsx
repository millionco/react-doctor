// rule: effect-needs-cleanup
// weakness: cleanup-provenance
// source: hand-written native parity regression
// verdict: pass

import { useEffect } from "react";

interface TimedRefreshProps {
  delays: number[];
  refresh: () => void;
}

export const TimedRefresh = ({ delays, refresh }: TimedRefreshProps) => {
  useEffect(() => {
    const timers = delays.map((delay) => setTimeout(refresh, delay));
    return () => timers.forEach(clearTimeout);
  }, [delays, refresh]);
  return null;
};
