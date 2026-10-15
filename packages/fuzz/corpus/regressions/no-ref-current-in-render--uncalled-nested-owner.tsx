// rule: no-ref-current-in-render
// weakness: name-heuristic
// source: synthetic
// verdict: pass
import { useCallback, useRef } from "react";

export const Panel = ({ value }) => {
  const container = useRef(null);
  const resolveValue = useCallback(() => {
    container.current = value;
  }, []);
  const Unused = () => resolveValue();
  return null;
};
