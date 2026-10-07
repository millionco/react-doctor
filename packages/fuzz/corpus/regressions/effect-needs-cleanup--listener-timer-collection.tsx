// rule: effect-needs-cleanup
// weakness: copy-tracking
// source: PR #1559 parity false positive
// verdict: pass

import { useEffect } from "react";

export const ListenerTimerCollection = () => {
  useEffect(() => {
    const timers = [];
    const handleResize = () => {
      timers.push(setTimeout(() => {}, 100));
      timers.push(setTimeout(() => {}, 200));
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      timers.forEach(clearTimeout);
    };
  }, []);
  return null;
};
