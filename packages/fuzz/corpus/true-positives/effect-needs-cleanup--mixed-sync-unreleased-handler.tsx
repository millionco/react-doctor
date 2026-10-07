// rule: effect-needs-cleanup
// verdict: fail
// weakness: ownership
// source: pull request review regression

import { useEffect } from "react";

export const Watchdog = ({ AppState, done }) => {
  useEffect(() => {
    let timer = null;
    const disarm = () => {
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const arm = () => {
      if (timer != null) return;
      timer = setTimeout(done, 1000);
    };
    const refresh = () => arm();
    refresh();
    AppState.addEventListener("change", refresh);
    return () => disarm();
  }, [AppState, done]);
  return null;
};
