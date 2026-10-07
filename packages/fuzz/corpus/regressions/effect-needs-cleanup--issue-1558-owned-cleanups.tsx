// verdict: pass
// rule: effect-needs-cleanup
// weakness: cleanup-provenance
// source: issue #1558

import { useCallback, useEffect, useRef } from "react";

export const Watchdog = ({ AppState, done }) => {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const disarm = () => {
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const arm = () => {
      if (timer != null) return;
      timer = setTimeout(done, 30_000);
    };
    const subscription = AppState.addEventListener("change", () => arm());
    arm();
    return () => {
      disarm();
      subscription.remove();
    };
  }, [AppState, done]);
  return null;
};

export const Tabs = ({ onPress, tabs }) => {
  useEffect(() => {
    const unsubscribers = tabs.map((tab) => tab.addListener("tabPress", onPress));
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [onPress, tabs]);
  return null;
};

export const PermissionCard = ({ interactive, requestId, resolved, timeoutMs }) => {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (resolved || !interactive) return;
    timerRef.current = setInterval(() => tick(requestId, timeoutMs), 1000);
    return () => stopTimer();
  }, [interactive, requestId, resolved, stopTimer, timeoutMs]);

  return null;
};
