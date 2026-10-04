// rule: effect-needs-cleanup
// weakness: framework-gating
// source: issue #1736 callback ref false positive
// verdict: pass

import { useCallback, useRef } from "react";

export const CallbackRefObserver = () => {
  const observerRef = useRef<ResizeObserver | null>(null);
  const setRef = useCallback((element: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!element) return;
    const observer = new ResizeObserver(() => {});
    observer.observe(element);
    observerRef.current = observer;
  }, []);
  return <div ref={setRef} />;
};
