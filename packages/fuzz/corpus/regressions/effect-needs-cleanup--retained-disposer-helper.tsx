// rule: effect-needs-cleanup
// verdict: safe
import { useRef, useCallback, useEffect } from "react";
export const Resizer = () => {
  const cleanup = useRef(null);
  const release = useCallback(() => {
    cleanup.current?.();
    cleanup.current = null;
  }, []);
  useEffect(
    () => () => {
      release();
    },
    [release],
  );
  const start = useCallback(() => {
    release();
    const move = () => update();
    window.addEventListener("pointermove", move, true);
    cleanup.current = () => window.removeEventListener("pointermove", move, true);
  }, [release]);
  return <div onPointerDown={start} />;
};
