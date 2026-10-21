// rule: no-ref-callback-cleanup-before-react-19
// verdict: fail
// weakness: wrapper-transparency
// source: synthetic
import { useCallback } from "react";

export const NoopHelperProloguePanel = () => {
  void 0;
  const createCleanup = useCallback((node: HTMLElement | null) => {
    void 0;
    if (!node) return;
    return () => {
      void 0;
      node.removeAttribute("data-active");
    };
  }, []);
  const bindNode = useCallback(
    (node: HTMLElement | null) => {
      void 0;
      const cleanup = createCleanup(node);
      return cleanup;
    },
    [createCleanup],
  );
  return <div ref={bindNode} />;
};
