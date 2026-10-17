// rule: no-ref-callback-cleanup-before-react-19
// verdict: fail
// weakness: wrapper-transparency
// source: synthetic
import { useCallback } from "react";

export const ForwardedCleanupPanel = () => {
  const createCleanup = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    return () => node.removeAttribute("data-active");
  }, []);
  const bindNode = useCallback(
    (node: HTMLElement | null) => {
      const cleanup = createCleanup(node);
      return cleanup;
    },
    [createCleanup],
  );
  return <div ref={bindNode} />;
};
