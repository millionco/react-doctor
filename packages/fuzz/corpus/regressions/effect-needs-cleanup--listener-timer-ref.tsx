// rule: effect-needs-cleanup
// weakness: control-flow
// source: PR #1559 parity false positive
// verdict: pass

import { useEffect, useRef } from "react";

export const ListenerTimerRef = () => {
  const timerRef = useRef(null);
  useEffect(() => {
    const handleResize = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {}, 100);
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      clearTimeout(timerRef.current);
    };
  }, []);
  return null;
};
