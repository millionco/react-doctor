// rule: no-ref-current-in-render
// weakness: control-flow
// source: synthetic
// verdict: pass
import { useCallback, useRef } from "react";

export const Panel = ({ value }) => {
  const enabled = false;
  const container = useRef(null);
  const resolveValue = useCallback(() => {
    if (!true) container.current = value;
    if (enabled) container.current = value;
    if (1 === 2) container.current = value;
  }, []);
  resolveValue();
  return null;
};
