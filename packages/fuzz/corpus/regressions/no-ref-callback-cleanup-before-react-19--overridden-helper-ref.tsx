// rule: no-ref-callback-cleanup-before-react-19
// verdict: pass
// weakness: wrapper-transparency
// source: synthetic
import { useCallback } from "react";

export const OverriddenHelperRefPanel = () => {
  const createCleanup = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    return () => node.removeAttribute("data-active");
  }, []);
  const bindNode = useCallback(
    (node: HTMLElement | null) => {
      return createCleanup(node);
    },
    [createCleanup],
  );
  return <div ref={bindNode} {...{ ref: null }} />;
};
