// verdict: pass
// rule: effect-needs-cleanup
// source: Issue #1831 - React 19 callback ref cleanup
// Weakness: The null branch creates no resource and needs no cleanup.
import { useCallback } from "react";

export const useContainerWidth = () => {
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    if (node === null) {
      return;
    }

    const observer = new ResizeObserver(() => {});
    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  return containerRef;
};
