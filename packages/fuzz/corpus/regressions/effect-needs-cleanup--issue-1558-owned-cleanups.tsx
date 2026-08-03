// verdict: pass
// rule: effect-needs-cleanup
// weakness: cleanup-provenance
// source: issue #1558

import { useEffect } from "react";

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
