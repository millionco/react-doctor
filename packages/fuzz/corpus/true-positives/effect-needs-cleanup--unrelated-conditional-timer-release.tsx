// rule: effect-needs-cleanup
// verdict: fail
// weakness: control-flow
// source: pull request review regression

import { useEffect } from "react";

export const Watchdog = ({ done, enabled }) => {
  useEffect(() => {
    let timer = null;
    const arm = () => {
      if (timer != null) return;
      timer = setTimeout(done, 1000);
    };
    arm();
    return () => {
      if (enabled) clearTimeout(timer);
    };
  }, [done, enabled]);
  return null;
};
