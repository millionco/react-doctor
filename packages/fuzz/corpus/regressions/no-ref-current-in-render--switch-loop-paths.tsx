// rule: no-ref-current-in-render
// weakness: control-flow
// source: synthetic
// verdict: pass
import { useCallback, useRef } from "react";

export const Panel = ({ value }) => {
  let active = false;
  const container = useRef(null);
  const resolveValue = useCallback(() => {
    switch (1) {
      case 2:
        container.current = value;
        break;
    }
    while (active) {
      container.current = value;
      active = false;
    }
  }, []);
  resolveValue();
  return null;
};
