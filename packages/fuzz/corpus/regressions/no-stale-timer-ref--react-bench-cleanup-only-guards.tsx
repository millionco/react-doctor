// rule: no-stale-timer-ref
// verdict: pass
// weakness: control-flow
// source: React Bench 0.9.6 exhaustive audit

import { useEffect, useRef } from "react";

export const PermissionTimer = ({ countdown, tick }) => {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    timerRef.current = setInterval(tick, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [tick]);
  useEffect(() => {
    if (countdown !== 0 || !timerRef.current) return;
    clearInterval(timerRef.current);
    timerRef.current = null;
  }, [countdown]);
  return null;
};
