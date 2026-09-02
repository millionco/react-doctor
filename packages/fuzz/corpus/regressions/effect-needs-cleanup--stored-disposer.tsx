// rule: effect-needs-cleanup
// weakness: cleanup-provenance
// source: issue #1736 stored disposer false positive
// verdict: pass

import { useEffect } from "react";

export const StoredDisposer = ({ element }: { element: HTMLElement }) => {
  useEffect(() => {
    let cleanupObserver = () => {};
    const observe = () => {
      const observer = new IntersectionObserver(() => {});
      observer.observe(element);
      return () => observer.disconnect();
    };
    cleanupObserver = observe();
    return () => cleanupObserver();
  }, [element]);
  return null;
};
