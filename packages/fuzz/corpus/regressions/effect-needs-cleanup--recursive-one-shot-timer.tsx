// rule: effect-needs-cleanup
// weakness: control-flow
// source: PR #1559 parity false positive
// verdict: pass

import { useEffect } from "react";

export const RecursiveOneShotTimer = () => {
  useEffect(() => {
    let timer = null;
    const schedule = () => {
      timer = setTimeout(schedule, 100);
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);
  return null;
};
