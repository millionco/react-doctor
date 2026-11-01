// rule: no-ref-current-in-render
// weakness: control-flow
// source: synthetic
// verdict: pass
import { useCallback, useRef } from "react";

export const Panel = () => {
  const container = useRef(0);
  const resolveValue = useCallback(() => {
    container.current += 1;
  }, []);
  if (0n) resolveValue();
  0n ? resolveValue() : null;
  return <output>Ready</output>;
};
