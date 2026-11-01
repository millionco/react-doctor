// rule: no-ref-callback-cleanup-before-react-19
// verdict: pass
// weakness: wrapper-transparency
// source: synthetic
import { useCallback } from "react";

export const ForwardedVoidPanel = () => {
  const updateNode = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    node.setAttribute("data-active", "true");
  }, []);
  const bindNode = useCallback(
    (node: HTMLElement | null) => {
      const result = updateNode(node);
      return result;
    },
    [updateNode],
  );
  return <div ref={bindNode} />;
};
