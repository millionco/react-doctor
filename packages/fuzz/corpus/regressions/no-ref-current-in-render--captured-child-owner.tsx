// rule: no-ref-current-in-render
// weakness: name-heuristic
// source: synthetic
// verdict: pass
import { useCallback, useRef } from "react";

export const Panel = ({ value }) => {
  const container = useRef(null);
  const Unused = () => {
    const resolveValue = useCallback(() => {
      container.current = value;
    }, []);
    resolveValue();
    return null;
  };
  return null;
};
