// rule: effect-needs-cleanup
// weakness: wrapper-transparency
// source: PR #1559 parity false positive
// verdict: pass

import { useEffect, useRef } from "react";

export const ListenerTimerHelper = () => {
  const timerRef = useRef(null);
  useEffect(() => {
    const clearTimer = () => clearTimeout(timerRef.current);
    const handleResize = () => {
      clearTimer();
      timerRef.current = setTimeout(() => {}, 100);
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      clearTimer();
    };
  }, []);
  return null;
};
