// rule: effect-needs-cleanup
// weakness: wrapper-transparency
// source: authored timer callback-ref regression
// verdict: pass

import { useCallback, useEffect, useRef } from "react";

export const Clock = ({ enabled, update }) => {
  const handleRef = useRef(null);
  const stop = useCallback(() => {
    if (handleRef.current) {
      clearInterval(handleRef.current);
      handleRef.current = null;
    }
  }, []);
  const stopRef = useRef(stop);
  stopRef.current = stop;

  useEffect(() => {
    if (!enabled) return;
    handleRef.current = setInterval(update, 1000);
    return () => {
      stopRef.current();
    };
  }, [enabled, update]);

  return <button onClick={stop}>Stop</button>;
};
